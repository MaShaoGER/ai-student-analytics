import { describe, expect, it } from "vitest";
import { BAILIAN_QWEN_FLASH, isBailianQwenFlash } from "./bailian";

describe("Bailian Qwen Flash request extensions", () => {
  it.each([
    BAILIAN_QWEN_FLASH.baseUrl,
    "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "https://workspace-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  ])("recognizes the official endpoint %s", (baseUrl) => {
    expect(isBailianQwenFlash({ ...BAILIAN_QWEN_FLASH, baseUrl })).toBe(true);
  });

  it.each([
    "",
    "https://models.example.test/v1",
    "https://dashscope.aliyuncs.com.example.test/compatible-mode/v1",
    "https://workspace.cn-beijing.maas.aliyuncs.com.example.test/v1",
    "https://dashscope.aliyuncs.com@models.example.test/v1",
    "http://dashscope.aliyuncs.com/compatible-mode/v1",
  ])("does not apply proprietary options to %s", (baseUrl) => {
    expect(isBailianQwenFlash({ ...BAILIAN_QWEN_FLASH, baseUrl })).toBe(false);
  });

  it("leaves other models on the same endpoint unchanged", () => {
    expect(isBailianQwenFlash({ ...BAILIAN_QWEN_FLASH, model: "another-model" })).toBe(false);
  });

  it.each([
    BAILIAN_QWEN_FLASH.baseUrl,
    "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  ])("also enables JSON/non-thinking options for Qwen3.7 Flash at %s", (baseUrl) => {
    expect(isBailianQwenFlash({ model: "qwen3.7-flash", baseUrl })).toBe(true);
  });
});
