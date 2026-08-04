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
  config: TestGenerationConfig;
  savedAt: number;
};

type LastTestState = {
  last: LastTestRecord | null;
  save: (config: TestGenerationConfig) => void;
  clear: () => void;
};

export function parseLastTestConfig(
  raw: unknown,
  base: TestGenerationConfig = APPLICATION_TEST_CONFIG,
): TestGenerationConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const candidate = (
    record.config && typeof record.config === "object"
      ? record.config
      : record
  ) as Record<string, unknown>;
  const mode = candidate.mode;
  if (mode !== "words" && mode !== "time") return null;

  const difficulty = candidate.difficulty === "normal"
    ? "medium"
    : candidate.difficulty;
  const input = {
    mode,
    wordCount: candidate.wordCount ?? candidate.count,
    durationSeconds:
      candidate.durationSeconds ?? candidate.durationSec ?? candidate.duration,
    difficulty: difficulty ?? base.difficulty,
    includeNumbers:
      candidate.includeNumbers ?? candidate.include_numbers ?? base.includeNumbers,
    includePunctuation:
      candidate.includePunctuation ??
      candidate.include_punctuation ??
      base.includePunctuation,
    seed: candidate.seed,
    wordSet: candidate.wordSet ?? base.wordSet,
    maxRepeatPerWord: candidate.maxRepeatPerWord ?? base.maxRepeatPerWord,
  } as TestGenerationConfigInput;

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
        const config = parseLastTestConfig(previous?.last);
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
export function readLastTestSafe(): TestGenerationConfig | null {
  try {
    const raw = localStorage.getItem("bk:lastTest:v1");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return parseLastTestConfig(obj?.state?.last);
  } catch {
    return null;
  }
}


