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

export type SpecialRunConfig = {
  mode: "words" | "time";
  wordCount: number | null;
  durationSec: number | null;
  language: string;
  include_punctuation: boolean;
  include_numbers: boolean;
};

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

export function specialRunConfig(input: {
  text: string;
  mode: "words" | "time";
  wordCount?: number | null;
  durationSec?: number | null;
  language: string;
}): SpecialRunConfig {
  return {
    mode: input.mode,
    wordCount: input.mode === "words" ? input.wordCount ?? null : null,
    durationSec: input.mode === "time" ? input.durationSec ?? null : null,
    language: input.language,
    include_punctuation: /[^\p{L}\p{N}\s]/u.test(input.text),
    include_numbers: /[0-9]/.test(input.text),
  };
}
