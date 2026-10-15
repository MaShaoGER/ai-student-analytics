import type { AIConfig } from "../client-types";

/** Public connection defaults only; API keys remain in server-side settings. */
export const ZHIPU_GLM_FLASH = {
  apiFormat: "chat_completions",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-4.7-flash",
} as const;

export function isZhipuGLMFlash(config: Pick<AIConfig, "baseUrl" | "model">): boolean {
  if (config.model !== ZHIPU_GLM_FLASH.model) return false;
  try {
    const url = new URL(config.baseUrl);
    return url.origin === "https://open.bigmodel.cn" &&
      url.pathname.replace(/\/+$/, "") === "/api/paas/v4" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
