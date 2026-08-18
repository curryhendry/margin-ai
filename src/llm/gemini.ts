import { requestUrl } from "obsidian";
import type { AIModel } from "../settings";
import {
  ChatMessage,
  StreamCallbacks,
  UsageInfo,
  LLMProvider,
  ChatOptions,
  ModelMeta,
  TestResult,
} from "./types";

/** Gemini 单个 SSE chunk 的形状 */
interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Gemini 流式对话客户端。
 * 使用 v1beta streamGenerateContent + SSE，解析 candidates 文本与 usageMetadata。
 */

/**
 * 测试连接 + 获取模型元数据（上下文/输出上限）。
 * 调用 v1beta models.get，返回 inputTokenLimit / outputTokenLimit。
 * 供设置页「测试连接」按钮和 provider.getModelMeta 共用。
 */
export async function testGeminiModel(model: AIModel): Promise<TestResult> {
  const base =
    model.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${base}/models/${encodeURIComponent(
    model.name
  )}?key=${model.apiKey}`;
  try {
    const r = await requestUrl({ url, throw: false });
    if (r.status >= 400) {
      const t = r.text || "";
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = r.json as Partial<{
      inputTokenLimit?: number;
      outputTokenLimit?: number;
    }>;
    const meta: ModelMeta = {};
    if (typeof j.inputTokenLimit === "number") {
      meta.inputTokenLimit = j.inputTokenLimit;
    }
    if (typeof j.outputTokenLimit === "number") {
      meta.outputTokenLimit = j.outputTokenLimit;
    }
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

export class GeminiProvider implements LLMProvider {
  id = "gemini";

  getModelMeta(model: AIModel): Promise<TestResult> {
    return testGeminiModel(model);
  }

  async chat(
    model: AIModel,
    messages: ChatMessage[],
    cb: StreamCallbacks,
    opts?: ChatOptions
  ): Promise<void> {
    const base =
      model.baseUrl ||
      "https://generativelanguage.googleapis.com/v1beta";
    const url = `${base}/models/${encodeURIComponent(
      model.name
    )}:streamGenerateContent?alt=sse&key=${model.apiKey}`;

    const contents = messages.map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = { contents };
    if (opts?.systemInstruction && opts.systemInstruction.trim()) {
      body.systemInstruction = {
        parts: [{ text: opts.systemInstruction }],
      };
    }

    // 用 XMLHttpRequest 做 SSE 流式读取（fetch 在 Obsidian 商店 lint 中被限制，
    // requestUrl 会缓冲整个响应无法流式；XHR 支持增量读取 responseText）
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");

      let usage: UsageInfo | null = null;
      let buf = "";
      let lastLen = 0;

      const parseChunk = (): void => {
        const text = xhr.responseText;
        buf += text.slice(lastLen);
        lastLen = text.length;
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const data = JSON.parse(json) as GeminiChunk;
            const piece =
              data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text || "")
                .join("") || "";
            if (piece) cb.onToken?.(piece);
            if (data.usageMetadata) {
              usage = {
                promptTokens: data.usageMetadata.promptTokenCount ?? 0,
                completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
                totalTokens: data.usageMetadata.totalTokenCount ?? 0,
              };
            }
          } catch {
            // 部分 chunk 可能不完整，忽略解析错误
          }
        }
      };

      xhr.onprogress = parseChunk;
      xhr.onload = () => {
        parseChunk();
        if (xhr.status >= 400) {
          cb.onError?.(
            new Error(`Gemini API ${xhr.status}: ${(xhr.responseText || "").slice(0, 300)}`)
          );
        } else {
          cb.onDone?.(usage);
        }
        resolve();
      };
      xhr.onerror = () => {
        cb.onError?.(new Error("网络请求失败"));
        resolve();
      };
      xhr.onabort = () => {
        cb.onError?.(new Error("请求已中断"));
        resolve();
      };
      try {
        xhr.send(JSON.stringify(body));
      } catch (e) {
        cb.onError?.(new Error("网络请求失败：" + (e as Error).message));
        resolve();
      }
    });
  }
}