import { requestUrl } from "obsidian";
import type { AIModel } from "../settings";
import { t } from "../i18n";
import {
  ChatMessage,
  StreamCallbacks,
  UsageInfo,
  LLMProvider,
  ChatOptions,
  ModelMeta,
  TestResult,
} from "./types";

/** DeepSeek OpenAI 兼容 /chat/completions 单个 SSE chunk 的形状 */
interface DeepSeekChunk {
  choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 识别常见 DeepSeek 错误，返回可读中文提示；其他错误原样返回 */
function friendlyError(status: number, body: string): string {
  const b = body || "";
  if (b.includes("Invalid API Key") || b.includes("invalid api key")) {
    return t("api.invalid_key");
  }
  if (b.includes("Insufficient Balance") || b.includes("insufficient user balance")) {
    return t("api.insufficient_balance");
  }
  if (b.includes("Rate limit") || b.includes("rate limit")) {
    return t("api.rate_limit");
  }
  return `DeepSeek API ${status}: ${b.slice(0, 300)}`;
}

export class DeepSeekProvider implements LLMProvider {
  id = "deepseek";

  async getModelMeta(model: AIModel): Promise<TestResult> {
    const base = model.baseUrl || "https://api.deepseek.com/v1";
    // DeepSeek 官方只有 GET /models 列表，无 /models/{id}；OpenAI 网关两处都支持。
    // 流程：GET /models（带鉴权）→ 校验模型名回填限额；若网关不实现 /models（404/405）
    // 则降级为对 /chat/completions 的最小联通性探测（非流式、空消息，不消耗计费）。
    const modelsRes = await this.authGet(`${base}/models`, model.apiKey);
    if (modelsRes.status < 400) {
      const list = (modelsRes.json as {
        data?: Array<{ id?: string; context_window?: number; max_output_tokens?: number }>;
      }).data;
      const hit = list?.find(
        (x) => x.id === model.name || x.id?.toLowerCase() === model.name.toLowerCase()
      );
      if (hit) {
        const meta: ModelMeta = {};
        if (typeof hit.context_window === "number") meta.inputTokenLimit = hit.context_window;
        if (typeof hit.max_output_tokens === "number") meta.outputTokenLimit = hit.max_output_tokens;
        return { ok: true, meta };
      }
      // /models 通了但列表里没有该模型：key 有效、模型名可能不对，仍报告成功让用户自查模型名
      return { ok: true, meta: {} };
    }
    if (modelsRes.status === 404 || modelsRes.status === 405) {
      // 网关不实现 /models：退化为联通性探测
      return this.probeConnectivity(base, model);
    }
    return { ok: false, error: friendlyError(modelsRes.status, modelsRes.text || "") };
  }

  /** 带鉴权的 GET */
  private async authGet(url: string, apiKey: string) {
    return requestUrl({ url, method: "GET", headers: { Authorization: `Bearer ${apiKey}` }, throw: false });
  }

  /** 最小联通性探测：POST /chat/completions，非流式、极短消息；网关不实现 /models 时的兜底 */
  private async probeConnectivity(base: string, model: AIModel): Promise<TestResult> {
    try {
      const r = await requestUrl({
        url: `${base}/chat/completions`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify({ model: model.name, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        throw: false,
      });
      if (r.status >= 400) return { ok: false, error: friendlyError(r.status, r.text || "") };
      return { ok: true, meta: {} };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || String(e) };
    }
  }

  async chat(
    model: AIModel,
    messages: ChatMessage[],
    cb: StreamCallbacks,
    opts?: ChatOptions
  ): Promise<void> {
    const base = model.baseUrl || "https://api.deepseek.com/v1";
    const url = `${base}/chat/completions`;

    const msgs: Record<string, unknown>[] = [];
    if (opts?.systemInstruction && opts.systemInstruction.trim()) {
      msgs.push({ role: "system", content: opts.systemInstruction });
    }
    // OpenAI 兼容格式角色为 user/assistant；Gemini 内部用 model，需映射
    for (const m of messages) {
      msgs.push({
        role: m.role === "model" ? "assistant" : "user",
        content: m.content,
      });
    }

    const body: Record<string, unknown> = {
      model: model.name,
      messages: msgs,
      stream: true,
      stream_options: { include_usage: true },
    };

    // 与 Gemini 一致：流式优先 XHR（SSE），失败且未输出时 requestUrl 兜底
    let usage: UsageInfo | null = null;
    let emitted = false;
    let usageEmitted = false;

    const handleDataJson = (json: string): void => {
      try {
        const data = JSON.parse(json) as DeepSeekChunk;
        const piece =
          data.choices?.[0]?.delta?.content ||
          data.choices?.[0]?.delta?.["reasoning_content"] ||
          "";
        if (piece) {
          emitted = true;
          cb.onToken?.(piece);
        }
        // 官方在 stream_options.include_usage 下，最后一块 chunk 带 usage
        if (data.usage && !usageEmitted) {
          usage = {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          };
          usageEmitted = true;
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

    // 部分网关 / 旧版本 DeepSeek 不支持 stream_options，先发一次不带参数的请求
    // 若报 400 则去掉 stream_options 重发（不重复输出）
    const send = async (
      withUsageFlag: boolean
    ): Promise<{ ok: boolean; error?: string }> => {
      const b: Record<string, unknown> = { ...body };
      if (!withUsageFlag) delete b.stream_options;
      const r = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(b),
        throw: false,
      });
      if (r.status >= 400) {
        return { ok: false, error: friendlyError(r.status, r.text || "") };
      }
      usage = null;
      usageEmitted = false;
      feedSSELines((r.text || "").split("\n"));
      cb.onDone?.(usage);
      return { ok: true };
    };

    // 路径一：XHR 流式
    const xhrResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", `Bearer ${model.apiKey}`);
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
            error: friendlyError(xhr.status, xhr.responseText || ""),
          });
        }
      };
      xhr.onerror = () => resolve({ ok: false, error: t("api.network_error") });
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

    // 路径二：requestUrl 兜底（Obsidian 主进程网络层）
    // 先带 stream_options 试一次，400 则去掉重试
    const r1 = await send(true);
    if (r1.ok) return;
    const s1 = (r1.error || "").toLowerCase();
    if (r1.error?.includes("400") || s1.includes("stream_options") || s1.includes("bad request")) {
      const r2 = await send(false);
      if (r2.ok) return;
      cb.onError?.(new Error(r2.error || "请求失败"));
      return;
    }
    cb.onError?.(new Error(r1.error || "请求失败"));
  }
}