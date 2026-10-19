import { createHash } from "node:crypto";
import { z } from "zod";
import { getRuntimeAIConfig } from "./ai";
import { readState, updateState } from "./storage";

export const analysisSettingsSchema = z
  .object({
    enabled: z.boolean(),
    maxToolCalls: z.number().int().min(2).max(8),
    timeoutSeconds: z.number().int().min(15).max(120),
  })
  .strict();
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;
type Capability = { fingerprint: string; supported: boolean; checkedAt: string };
type State = { settings: AnalysisSettings; capability: Capability | null };
const initial = (): State => ({
  settings: { enabled: true, maxToolCalls: 6, timeoutSeconds: 60 },
  capability: null,
});

// Bound evidence to the actual endpoint, protocol, model AND key. Never expose this hash.
export function analysisConfigFingerprint(): string {
  const config = getRuntimeAIConfig();
  return createHash("sha256")
    .update(JSON.stringify([config.baseUrl, config.apiFormat, config.model, config.apiKey]))
    .digest("hex");
}
export function getAnalysisSettings(): AnalysisSettings {
  return analysisSettingsSchema.parse(readState("analysis-settings.json", initial).settings);
}
export function getAnalysisCapability() {
  const stored = readState("analysis-settings.json", initial).capability;
  let matches = false;
  try {
    matches = Boolean(stored && stored.fingerprint === analysisConfigFingerprint());
  } catch {
    /* Unconfigured. */
  }
  return {
    status: matches
      ? stored!.supported
        ? ("supported" as const)
        : ("failed" as const)
      : ("unknown" as const),
    checkedAt: matches ? stored!.checkedAt : null,
  };
}
export function saveAnalysisSettings(input: unknown) {
  const settings = analysisSettingsSchema.parse(input);
  return updateState("analysis-settings.json", initial, (state) => (state.settings = settings));
}
export function saveAnalysisCapability(fingerprint: string, supported: boolean) {
  updateState("analysis-settings.json", initial, (state) => {
    state.capability = { fingerprint, supported, checkedAt: new Date().toISOString() };
  });
  return getAnalysisCapability();
}
