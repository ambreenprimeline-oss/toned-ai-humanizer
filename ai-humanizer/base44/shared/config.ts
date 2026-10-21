export const PROMPT_VERSION = "humanizer/1.0.0";

/**
 * All runtime configuration is read from environment/secrets at call time.
 * Nothing is hardcoded in the pipeline: model IDs, caps and pricing are
 * overridable by setting the corresponding secret.
 */
export function buildConfig(secret) {
  const read = (name, fallback) => {
    const value = secret(name);
    if (value === undefined || value === null || value === "") return fallback;
    return value;
  };
  const asNumber = (name, fallback) => {
    const parsed = Number(read(name, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    promptVersion: PROMPT_VERSION,
    modelFast: read("MODEL_FAST", "claude-haiku-4-5-20251001"),
    modelQuality: read("MODEL_QUALITY", "claude-sonnet-5-5"),
    maxInputChars: asNumber("MAX_INPUT_CHARS", 20000),
    maxJobTokens: asNumber("MAX_JOB_TOKENS", 120000),
    retentionDaysDefault: asNumber("RETENTION_DAYS_DEFAULT", 30),
    chunkWords: 800,
    maxRepairLoops: 2,
    retentionOptions: [0, 7, 30, 90],
    // USD per 1M tokens, used for the per-job cost estimate shown to the user.
    pricing: {
      fast: { input: 1, output: 5 },
      quality: { input: 2, output: 10 },
    },
    // Models used when no ANTHROPIC_API_KEY is configured.
    platformModels: { fast: "gemini_3_8_flash", quality: "claude-sonnet-5" },
  };
}