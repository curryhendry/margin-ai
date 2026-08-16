import { AIModel } from "../settings";

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamCallbacks {
  /** 每收到一段文本 */
  onToken?: (text: string) => void;
  /** 整次请求完成，返回用量（若有） */
  onDone?: (usage: UsageInfo | null) => void;
  /** 出错 */
  onError?: (err: Error) => void;
}

export interface ChatOptions {
  systemInstruction?: string;
}

/**
 * 供应商抽象层。初期仅 Gemini，后期扩展 OpenAI / Claude 时实现同一接口即可。
 */
export interface LLMProvider {
  id: string;
  chat(
    model: AIModel,
    messages: ChatMessage[],
    cb: StreamCallbacks,
    opts?: ChatOptions
  ): Promise<void>;
}
