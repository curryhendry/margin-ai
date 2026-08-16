import type { AIModel } from "../settings";

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

/** 模型元数据：上下文 / 输出 token 上限（来自 Gemini models.get） */
export interface ModelMeta {
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/** 连接测试结果 */
export interface TestResult {
  ok: boolean;
  meta?: ModelMeta;
  error?: string;
}

/**
 * 供应商抽象层。初期仅 Gemini。
 * chat 为流式对话；getModelMeta 可选，用于连接测试 + 取模型限额。
 */
export interface LLMProvider {
  id: string;
  chat(
    model: AIModel,
    messages: ChatMessage[],
    cb: StreamCallbacks,
    opts?: ChatOptions
  ): Promise<void>;
  getModelMeta?(model: AIModel): Promise<TestResult>;
}