import type { WordSetKey } from "@/lib/wordbanks";

export type TestMode = "words" | "time";
export type TestDifficulty = "auto" | "easy" | "medium" | "hard";

export type TestGenerationConfig = {
  mode: TestMode;
  wordCount?: number;
  durationSeconds?: number;
  difficulty: TestDifficulty;
  includePunctuation: boolean;
  includeNumbers: boolean;
  seed?: number;
  wordSet: WordSetKey;
  maxRepeatPerWord: number;
};

export type TestGenerationConfigInput = Partial<TestGenerationConfig> & {
  mode?: TestMode;
};

export type InitialTestConfigSources = {
  applicationDefaults?: TestGenerationConfig;
  persistedDefaults?: TestGenerationConfigInput | null;
  lastUsed?: TestGenerationConfigInput | null;
  explicitOverride?: TestGenerationConfigInput | null;
};

export type TestConfigErrorCode =
  | "INVALID_MODE"
  | "INVALID_WORD_COUNT"
  | "INVALID_DURATION"
  | "INVALID_DIFFICULTY"
  | "INVALID_PUNCTUATION_FLAG"
  | "INVALID_NUMBERS_FLAG"
  | "INVALID_SEED"
  | "INVALID_WORD_SET"
  | "INVALID_REPEAT_LIMIT";

export class TestConfigError extends Error {
  readonly code: TestConfigErrorCode;

  constructor(code: TestConfigErrorCode, message: string) {
    super(message);
    this.name = "TestConfigError";
    this.code = code;
  }
}

export const WORD_TEST_COUNTS = [10, 15, 20, 30, 50] as const;
export const TIME_TEST_DURATIONS = [15, 30, 60, 120] as const;

export const APPLICATION_TEST_CONFIG: Readonly<TestGenerationConfig> = Object.freeze({
  mode: "words",
  wordCount: 15,
  difficulty: "auto",
  includePunctuation: false,
  includeNumbers: false,
  wordSet: "core5000",
  maxRepeatPerWord: 2,
});

const WORD_COUNTS = new Set<number>(WORD_TEST_COUNTS);
const TIME_DURATIONS = new Set<number>(TIME_TEST_DURATIONS);
const DIFFICULTIES = new Set<TestDifficulty>(["auto", "easy", "medium", "hard"]);
const WORD_SETS = new Set<WordSetKey>(["core200", "core1000", "core5000"]);

function assertBoolean(value: unknown, code: TestConfigErrorCode, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TestConfigError(code, `${field} must be a boolean`);
  }
  return value;
}

function assertSeed(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 0xffffffff) {
    throw new TestConfigError(
      "INVALID_SEED",
      "seed must be an integer between 0 and 4294967295",
    );
  }
  return Number(value) >>> 0;
}

export function normalizeTestGenerationConfig(
  input: TestGenerationConfigInput,
  base: TestGenerationConfig = APPLICATION_TEST_CONFIG,
): TestGenerationConfig {
  const merged = { ...base, ...input };
  if (merged.mode !== "words" && merged.mode !== "time") {
    throw new TestConfigError("INVALID_MODE", "mode must be words or time");
  }
  if (!DIFFICULTIES.has(merged.difficulty)) {
    throw new TestConfigError("INVALID_DIFFICULTY", "difficulty is invalid");
  }
  if (!WORD_SETS.has(merged.wordSet)) {
    throw new TestConfigError("INVALID_WORD_SET", "wordSet is invalid");
  }
  if (
    !Number.isInteger(merged.maxRepeatPerWord) ||
    merged.maxRepeatPerWord < 1 ||
    merged.maxRepeatPerWord > 5
  ) {
    throw new TestConfigError(
      "INVALID_REPEAT_LIMIT",
      "maxRepeatPerWord must be an integer between 1 and 5",
    );
  }

  const seed = assertSeed(merged.seed);
  const common = {
    mode: merged.mode,
    difficulty: merged.difficulty,
    includePunctuation: assertBoolean(
      merged.includePunctuation,
      "INVALID_PUNCTUATION_FLAG",
      "includePunctuation",
    ),
    includeNumbers: assertBoolean(
      merged.includeNumbers,
      "INVALID_NUMBERS_FLAG",
      "includeNumbers",
    ),
    ...(seed === undefined ? {} : { seed }),
    wordSet: merged.wordSet,
    maxRepeatPerWord: merged.maxRepeatPerWord,
  };

  if (merged.mode === "words") {
    const wordCount = Number(merged.wordCount);
    if (!WORD_COUNTS.has(wordCount)) {
      throw new TestConfigError(
        "INVALID_WORD_COUNT",
        `wordCount must be one of ${WORD_TEST_COUNTS.join(", ")}`,
      );
    }
    return {
      ...common,
      mode: "words",
      wordCount,
    };
  }

  const durationSeconds = Number(merged.durationSeconds);
  if (!TIME_DURATIONS.has(durationSeconds)) {
    throw new TestConfigError(
      "INVALID_DURATION",
      `durationSeconds must be one of ${TIME_TEST_DURATIONS.join(", ")}`,
    );
  }
  return {
    ...common,
    mode: "time",
    durationSeconds,
  };
}

function applyValidSource(
  current: TestGenerationConfig,
  candidate: TestGenerationConfigInput | null | undefined,
): TestGenerationConfig {
  if (!candidate) return current;
  try {
    return normalizeTestGenerationConfig(candidate, current);
  } catch {
    return current;
  }
}

export function resolveInitialTestConfig(
  sources: InitialTestConfigSources = {},
): Readonly<TestGenerationConfig> {
  let resolved = normalizeTestGenerationConfig(
    sources.applicationDefaults ?? APPLICATION_TEST_CONFIG,
  );
  resolved = applyValidSource(resolved, sources.persistedDefaults);
  resolved = applyValidSource(resolved, sources.lastUsed);
  if (sources.explicitOverride) {
    resolved = normalizeTestGenerationConfig(sources.explicitOverride, resolved);
  }
  return Object.freeze({ ...resolved });
}

export function expectedTokenCount(config: TestGenerationConfig): number {
  return config.mode === "words" ? Number(config.wordCount) : 200;
}
