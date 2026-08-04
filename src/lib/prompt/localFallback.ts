import { StringLRU } from "@/lib/lru";
import { finalizeGeneratedPrompt, type FinalizePromptResult } from "@/lib/prompt/finalizeGeneratedPrompt";
import { sampleNormalWords } from "@/lib/prompt/normalSampler";
import {
  expectedTokenCount,
  normalizeTestGenerationConfig,
  type TestGenerationConfig,
} from "@/lib/prompt/testGenerationConfig";
import { mulberry32, randomSeed } from "@/lib/prng";

export type LocalFallbackInput = {
  config: TestGenerationConfig;
  wordPool: string[];
  recentWords?: string[];
};

function generateFallback(input: LocalFallbackInput): FinalizePromptResult {
  const config = normalizeTestGenerationConfig(input.config);
  const seed = config.seed ?? randomSeed();
  const count = expectedTokenCount(config);
  const lru = new StringLRU(1000, input.recentWords ?? []);
  const picks = sampleNormalWords({
    bank: input.wordPool,
    prng: mulberry32(seed),
    lru,
    count,
    dist: { easy: 70, medium: 25, hard: 5 },
  });

  return finalizeGeneratedPrompt({
    rawText: picks.join(" "),
    config,
    expectedTokenCount: count,
    seed,
    wordPool: input.wordPool,
  });
}

export function generateWordFallback(input: LocalFallbackInput): FinalizePromptResult {
  if (input.config.mode !== "words") {
    throw new Error("generateWordFallback requires words mode");
  }
  return generateFallback(input);
}

export function generateTimeFallback(input: LocalFallbackInput): FinalizePromptResult {
  if (input.config.mode !== "time") {
    throw new Error("generateTimeFallback requires time mode");
  }
  return generateFallback(input);
}
