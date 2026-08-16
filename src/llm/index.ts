import { GeminiProvider } from "./gemini";
import { LLMProvider } from "./types";

/**
 * 供应商注册表。后期扩展时在此注册新的 Provider 即可：
 *   providers["openai"] = new OpenAIProvider();
 */
export const providers: Record<string, LLMProvider> = {
  gemini: new GeminiProvider(),
};

export function getProvider(id: string): LLMProvider {
  const p = providers[id];
  if (!p) throw new Error(`未知的供应商：${id}`);
  return p;
}
