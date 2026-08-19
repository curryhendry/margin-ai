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

    // 流式优先走 XHR（fetch 在商店 lint 中被限制；requestUrl 会缓冲整个响应无法流式）。
    // XHR 失败且尚未输出任何内容时，自动用 requestUrl 兜底——requestUrl 走 Obsidian
    // 主进程网络层，代理/网络配置与渲染进程不同，可绕过渲染进程直连被限制的情况。
    let usage: UsageInfo | null = null;
    let emitted = false;

    const handleDataJson = (json: string): void => {
      try {
        const data = JSON.parse(json) as GeminiChunk;
        const piece =
          data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || "")
            .join("") || "";
        if (piece) {
          emitted = true;
          cb.onToken?.(piece);
        }
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
    };

    const feedSSELines = (lines: string[]): void => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const json = trimmed.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        handleDataJson(json);
      }
    };

    // 路径一：XHR 流式
    const xhrResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      let buf = "";
      let lastLen = 0;
      const drain = (): void => {
        buf += xhr.responseText.slice(lastLen);
        lastLen = xhr.responseText.length;
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        feedSSELines(lines);
      };
      xhr.onprogress = drain;
      xhr.onload = () => {
        drain();
        if (xhr.status < 400) {
          cb.onDone?.(usage);
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: `Gemini API ${xhr.status}: ${(xhr.responseText || "").slice(0, 300)}`,
          });
        }
      };
      xhr.onerror = () => resolve({ ok: false, error: "网络请求失败" });
      xhr.onabort = () => resolve({ ok: false, error: "请求已中断" });
      try {
        xhr.send(JSON.stringify(body));
      } catch (e) {
        resolve({ ok: false, error: "网络请求失败：" + (e as Error).message });
      }
    });

    if (xhrResult.ok) return;
    if (emitted) {
      // 已输出部分内容再失败：不兜底（避免重复输出），直接报错
      cb.onError?.(new Error(xhrResult.error || "请求失败"));
      return;
    }

    // 路径二：requestUrl 兜底（Obsidian 主进程网络层，缓冲式解析）
    try {
      const r = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        throw: false,
      });
      if (r.status >= 400) {
        cb.onError?.(
          new Error(`Gemini API ${r.status}: ${(r.text || "").slice(0, 300)}`)
        );
        return;
      }
      usage = null;
      feedSSELines((r.text || "").split("\n"));
      cb.onDone?.(usage);
    } catch (e) {
      cb.onError?.(new Error("网络请求失败：" + (e as Error).message));
    }
  }
}