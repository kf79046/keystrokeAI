"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  APPLICATION_TEST_CONFIG,
  normalizeTestGenerationConfig,
  type TestGenerationConfig,
  type TestGenerationConfigInput,
} from "@/lib/prompt/testGenerationConfig";

export type LastTestRecord = {
  config: TestGenerationConfigInput;
  savedAt: number;
};

type LastTestState = {
  last: LastTestRecord | null;
  save: (config: TestGenerationConfig) => void;
  clear: () => void;
};

export function parseLastTestConfigInput(
  raw: unknown,
): TestGenerationConfigInput | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const candidate = (
    record.config && typeof record.config === "object"
      ? record.config
      : record
  ) as Record<string, unknown>;
  const mode = candidate.mode;
  if (mode !== "words" && mode !== "time") return null;

  const input: TestGenerationConfigInput = {
    mode,
  };
  const wordCount = candidate.wordCount ?? candidate.count;
  const durationSeconds =
    candidate.durationSeconds ?? candidate.durationSec ?? candidate.duration;
  const difficulty = candidate.difficulty === "normal"
    ? "medium"
    : candidate.difficulty;
  const includeNumbers = candidate.includeNumbers ?? candidate.include_numbers;
  const includePunctuation =
    candidate.includePunctuation ?? candidate.include_punctuation;
  if (wordCount != null) input.wordCount = wordCount as number;
  if (durationSeconds != null) {
    input.durationSeconds = durationSeconds as number;
  }
  if (difficulty != null) {
    input.difficulty = difficulty as TestGenerationConfig["difficulty"];
  }
  if (includeNumbers != null) input.includeNumbers = includeNumbers as boolean;
  if (includePunctuation != null) {
    input.includePunctuation = includePunctuation as boolean;
  }
  if (candidate.seed != null) input.seed = candidate.seed as number;
  if (candidate.wordSet != null) {
    input.wordSet = candidate.wordSet as TestGenerationConfig["wordSet"];
  }
  if (candidate.maxRepeatPerWord != null) {
    input.maxRepeatPerWord = candidate.maxRepeatPerWord as number;
  }

  try {
    normalizeTestGenerationConfig(input);
    return input;
  } catch {
    return null;
  }
}

export function parseLastTestConfig(
  raw: unknown,
  base: TestGenerationConfig = APPLICATION_TEST_CONFIG,
): TestGenerationConfig | null {
  const input = parseLastTestConfigInput(raw);
  if (!input) return null;
  try {
    return normalizeTestGenerationConfig(input, base);
  } catch {
    return null;
  }
}

export const useLastTestStore = create<LastTestState>()(
  persist(
    (set) => ({
      last: null,
      save: (config) => set({
        last: {
          config: normalizeTestGenerationConfig(config),
          savedAt: Date.now(),
        },
      }),
      clear: () => set({ last: null }),
    }),
    {
      name: "bk:lastTest:v1",
      version: 2,
      migrate: (persisted) => {
        const previous = persisted as { last?: unknown } | null;
        const config = parseLastTestConfigInput(previous?.last);
        return {
          last: config
            ? {
                config,
                savedAt: Number(
                  (previous?.last as { savedAt?: unknown; ts?: unknown } | undefined)
                    ?.savedAt ??
                  (previous?.last as { ts?: unknown } | undefined)?.ts ??
                  Date.now(),
                ),
              }
            : null,
        };
      },
    },
  )
);

/** Fallback reader for hydration race: read directly from localStorage if needed. */
export function readLastTestSafe(): TestGenerationConfigInput | null {
  try {
    const raw = localStorage.getItem("bk:lastTest:v1");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return parseLastTestConfigInput(obj?.state?.last);
  } catch {
    return null;
  }
}


