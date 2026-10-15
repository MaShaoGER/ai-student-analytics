import type { AIConfig } from "../client-types";

/** Public connection defaults only; API keys remain in server-side settings. */
export const BAILIAN_QWEN_FLASH = {
  apiFormat: "chat_completions",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3.8-flash",
} as const;

export function isBailianQwenFlash(config: Pick<AIConfig, "baseUrl" | "model">): boolean {
  if (config.model !== BAILIAN_QWEN_FLASH.model && config.model !== "qwen3.7-flash") return false;
  try {
    const url = new URL(config.baseUrl);
    return url.protocol === "https:" && (
      url.hostname === "dashscope.aliyuncs.com" ||
      url.hostname === "dashscope-intl.aliyuncs.com" ||
      url.hostname === "dashscope-us.aliyuncs.com" ||
      /^[a-zA-Z0-9-]+\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
