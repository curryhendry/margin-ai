import { AIModel } from "../settings";
import { ChatMessage, StreamCallbacks, UsageInfo, LLMProvider, ChatOptions } from "./types";

/**
 * Gemini 流式对话客户端。
 * 使用 v1beta streamGenerateContent + SSE，解析 candidates 文本与 usageMetadata。
 */
export class GeminiProvider implements LLMProvider {
  id = "gemini";

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

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      cb.onError?.(new Error("网络请求失败：" + (e as Error).message));
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      cb.onError?.(new Error(`Gemini API ${res.status}: ${text.slice(0, 300)}`));
      return;
    }
    if (!res.body) {
      cb.onError?.(new Error("响应为空"));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usage: UsageInfo | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const data = JSON.parse(json);
            const text =
              data.candidates?.[0]?.content?.parts
                ?.map((p: { text?: string }) => p.text || "")
                .join("") || "";
            if (text) cb.onToken?.(text);
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
      }
    } catch (e) {
      cb.onError?.(new Error("读取响应失败：" + (e as Error).message));
      return;
    }

    cb.onDone?.(usage);
  }
}
