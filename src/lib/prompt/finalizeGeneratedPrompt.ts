import { applyEasyFilter } from "@/lib/prompt/easyFilter";
import { normalizePromptWords } from "@/lib/text";
import { mulberry32, randomSeed } from "@/lib/prng";
import { sanitizePrompt } from "@/lib/prompt/sanitize";
import {
  normalizeTestGenerationConfig,
  type TestGenerationConfig,
} from "@/lib/prompt/testGenerationConfig";

export type PromptFinalizationStageName =
  | "normalized"
  | "count-repaired"
  | "easy-filtered"
  | "sanitized"
  | "numbers-guaranteed"
  | "punctuation-guaranteed"
  | "validated";

export type PromptFinalizationStage = {
  name: PromptFinalizationStageName;
  text: string;
  warnings: string[];
};

export type FinalizePromptInput = {
  rawText: string;
  config: TestGenerationConfig;
  expectedTokenCount: number;
  seed?: number;
  wordPool: string[];
  priorTokens?: string[];
};

export type FinalizePromptResult = {
  text: string;
  seed: number;
  requestedConfig: TestGenerationConfig;
  effectiveConfig: TestGenerationConfig;
  stages: PromptFinalizationStage[];
  warnings: string[];
};

export type PromptFinalizationErrorCode =
  | "EMPTY_RAW_TEXT"
  | "INVALID_EXPECTED_TOKEN_COUNT"
  | "CONFIG_COUNT_MISMATCH"
  | "INVALID_WORD_POOL"
  | "TOKEN_COUNT_MISMATCH"
  | "PUNCTUATION_CONTRACT_FAILED"
  | "NUMBERS_CONTRACT_FAILED";

export class PromptFinalizationError extends Error {
  readonly code: PromptFinalizationErrorCode;

  constructor(code: PromptFinalizationErrorCode, message: string) {
    super(message);
    this.name = "PromptFinalizationError";
    this.code = code;
  }
}

const DIGIT_RE = /[0-9]/;
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/u;
const PUNCTUATION_MARKS = [".", ",", "?", "!"] as const;

function tokensOf(text: string): string[] {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

function lowerLetters(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .split("")
    .map((character) => (
      /\p{L}/u.test(character)
        ? character.toLocaleLowerCase("en-US")
        : character
    ))
    .join("");
}

function validateSeed(seed: number | undefined, configSeed: number | undefined): number {
  const value = seed ?? configSeed ?? randomSeed();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("seed must be an integer between 0 and 4294967295");
  }
  return value >>> 0;
}

function stage(
  stages: PromptFinalizationStage[],
  name: PromptFinalizationStageName,
  text: string,
  warnings: string[] = [],
) {
  stages.push({ name, text, warnings });
}

export function finalizeGeneratedPrompt(
  input: FinalizePromptInput,
): FinalizePromptResult {
  const config = normalizeTestGenerationConfig(input.config);
  const expected = Number(input.expectedTokenCount);
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new PromptFinalizationError(
      "INVALID_EXPECTED_TOKEN_COUNT",
      "expectedTokenCount must be a positive integer",
    );
  }
  if (config.mode === "words" && config.wordCount !== expected) {
    throw new PromptFinalizationError(
      "CONFIG_COUNT_MISMATCH",
      "word-mode config and expectedTokenCount must agree",
    );
  }
  if (!String(input.rawText ?? "").trim()) {
    throw new PromptFinalizationError("EMPTY_RAW_TEXT", "rawText must not be empty");
  }

  const easyPool = input.wordPool
    .map((word) => String(word ?? "").trim().toLowerCase())
    .filter((word) => /^[a-z]{1,8}$/.test(word));
  if (easyPool.length === 0) {
    throw new PromptFinalizationError(
      "INVALID_WORD_POOL",
      "wordPool must contain an easy replacement word",
    );
  }

  const seed = validateSeed(input.seed, config.seed);
  const random = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const stages: PromptFinalizationStage[] = [];
  const warnings: string[] = [];

  let text = normalizePromptWords(lowerLetters(input.rawText));
  stage(stages, "normalized", text);

  let tokens = tokensOf(text);
  const countWarnings: string[] = [];
  if (tokens.length > expected) {
    tokens = tokens.slice(0, expected);
    countWarnings.push(`Truncated ${tokensOf(text).length - expected} excess tokens.`);
  } else if (tokens.length < expected) {
    const missing = expected - tokens.length;
    for (let index = 0; index < missing; index += 1) {
      tokens.push(easyPool[Math.floor(random() * easyPool.length)]);
    }
    countWarnings.push(`Replaced ${missing} missing tokens from the supplied word pool.`);
  }
  warnings.push(...countWarnings);
  text = tokens.join(" ");
  stage(stages, "count-repaired", text, countWarnings);

  text = applyEasyFilter(text, easyPool, {
    maxLen: 8,
    maxRepeat: config.maxRepeatPerWord,
    random,
    allowPunctuation: config.includePunctuation,
    allowNumbers: config.includeNumbers,
    initialTokens: input.priorTokens,
  });
  stage(stages, "easy-filtered", text);

  text = sanitizePrompt(text, {
    allowPunctuation: config.includePunctuation,
    allowNumbers: config.includeNumbers,
  });
  stage(stages, "sanitized", text);

  tokens = tokensOf(text);
  if (tokens.length !== expected) {
    const repaired = tokens.slice(0, expected);
    while (repaired.length < expected) {
      repaired.push(easyPool[Math.floor(random() * easyPool.length)]);
    }
    const warning = "Sanitization changed token count; missing tokens were replaced.";
    warnings.push(warning);
    tokens = repaired;
    text = tokens.join(" ");
    stage(stages, "count-repaired", text, [warning]);
  }

  if (config.includeNumbers && !DIGIT_RE.test(text)) {
    const index = Math.floor(random() * tokens.length);
    tokens[index] = String(1 + Math.floor(random() * 999));
    text = tokens.join(" ");
    const warning = "Added a deterministic numeric token required by the active config.";
    warnings.push(warning);
    stage(stages, "numbers-guaranteed", text, [warning]);
  }

  if (config.includePunctuation && !PUNCTUATION_RE.test(text)) {
    const index = Math.floor(random() * tokens.length);
    const mark = PUNCTUATION_MARKS[Math.floor(random() * PUNCTUATION_MARKS.length)];
    tokens[index] = `${tokens[index]}${mark}`;
    text = tokens.join(" ");
    const warning = "Added deterministic punctuation required by the active config.";
    warnings.push(warning);
    stage(stages, "punctuation-guaranteed", text, [warning]);
  }

  text = sanitizePrompt(text, {
    allowPunctuation: config.includePunctuation,
    allowNumbers: config.includeNumbers,
  });
  const finalTokens = tokensOf(text);
  const hasPunctuation = PUNCTUATION_RE.test(text);
  const hasNumbers = DIGIT_RE.test(text);

  if (finalTokens.length !== expected) {
    throw new PromptFinalizationError(
      "TOKEN_COUNT_MISMATCH",
      `finalized prompt contains ${finalTokens.length} tokens; expected ${expected}`,
    );
  }
  if (hasPunctuation !== config.includePunctuation) {
    throw new PromptFinalizationError(
      "PUNCTUATION_CONTRACT_FAILED",
      "finalized prompt punctuation does not match the active config",
    );
  }
  if (hasNumbers !== config.includeNumbers) {
    throw new PromptFinalizationError(
      "NUMBERS_CONTRACT_FAILED",
      "finalized prompt numbers do not match the active config",
    );
  }
  stage(stages, "validated", text);

  return {
    text,
    seed,
    requestedConfig: { ...config },
    effectiveConfig: {
      ...config,
      includePunctuation: hasPunctuation,
      includeNumbers: hasNumbers,
    },
    stages,
    warnings,
  };
}
