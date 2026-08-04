import type {
  TestDifficulty,
  TestGenerationConfig,
} from "@/lib/prompt/testGenerationConfig";

export type ResolvedTestDifficulty = Exclude<TestDifficulty, "auto">;

export type FinalizedSoloPrompt = {
  kind: "finalized-solo";
  text: string;
  seed: number;
  requestedConfig: TestGenerationConfig;
  effectiveConfig: TestGenerationConfig;
  resolvedDifficulty?: ResolvedTestDifficulty;
};

export type TypingPrompt = string | FinalizedSoloPrompt;

export type RenderedTestConfig = {
  mode: "words" | "time";
  wordCount: number | null;
  durationSec: number | null;
  language: "english";
  include_punctuation: boolean;
  include_numbers: boolean;
};

export function isFinalizedSoloPrompt(
  prompt: TypingPrompt,
): prompt is FinalizedSoloPrompt {
  return typeof prompt === "object" && prompt.kind === "finalized-solo";
}

export function promptText(prompt: TypingPrompt): string {
  return isFinalizedSoloPrompt(prompt) ? prompt.text : prompt;
}

export function renderedTestConfig(
  prompt: FinalizedSoloPrompt,
): RenderedTestConfig {
  const config = prompt.effectiveConfig;
  return {
    mode: config.mode,
    wordCount: config.wordCount ?? null,
    durationSec: config.durationSeconds ?? null,
    language: "english",
    include_punctuation: config.includePunctuation,
    include_numbers: config.includeNumbers,
  };
}
