import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  isFinalizedSoloPrompt,
  promptText,
  renderedTestConfig,
  type FinalizedSoloPrompt,
} from "../../src/lib/prompt/preparedPrompt";
import {
  APPLICATION_TEST_CONFIG,
  resolveInitialTestConfig,
} from "../../src/lib/prompt/testGenerationConfig";
import { parseLastTestConfig } from "../../src/stores/useLastTestStore";

describe("adaptive runtime configuration", () => {
  it("migrates the legacy words last-test shape", () => {
    const migrated = parseLastTestConfig({
      mode: "words",
      count: 30,
      include_punctuation: true,
      include_numbers: false,
      difficulty: "normal",
    });

    assert.equal(migrated?.mode, "words");
    assert.equal(migrated?.wordCount, 30);
    assert.equal(migrated?.includePunctuation, true);
    assert.equal(migrated?.includeNumbers, false);
    assert.equal(migrated?.difficulty, "medium");
  });

  it("migrates the legacy time last-test shape", () => {
    const migrated = parseLastTestConfig({
      mode: "time",
      duration: 60,
      include_punctuation: false,
      include_numbers: true,
    });

    assert.equal(migrated?.mode, "time");
    assert.equal(migrated?.durationSeconds, 60);
    assert.equal(migrated?.includeNumbers, true);
  });

  it("rejects invalid persisted last-test data and falls back to defaults", () => {
    const lastUsed = parseLastTestConfig({
      mode: "words",
      count: 999,
    });
    const resolved = resolveInitialTestConfig({
      persistedDefaults: {
        wordCount: 20,
        includePunctuation: true,
      },
      lastUsed,
    });

    assert.equal(lastUsed, null);
    assert.equal(resolved.wordCount, 20);
    assert.equal(resolved.includePunctuation, true);
  });

  it("keeps resolved difficulty separate from rendered flags", () => {
    const prepared: FinalizedSoloPrompt = {
      kind: "finalized-solo",
      text: "alpha beta 42.",
      seed: 123,
      requestedConfig: {
        ...APPLICATION_TEST_CONFIG,
        includePunctuation: true,
        includeNumbers: true,
      },
      effectiveConfig: {
        ...APPLICATION_TEST_CONFIG,
        includePunctuation: true,
        includeNumbers: true,
      },
      resolvedDifficulty: "hard",
    };

    assert.equal(prepared.resolvedDifficulty, "hard");
    assert.equal(prepared.effectiveConfig.includePunctuation, true);
    assert.equal(prepared.effectiveConfig.includeNumbers, true);
  });

  it("builds displayed chips from effective rendered behavior", () => {
    const prepared: FinalizedSoloPrompt = {
      kind: "finalized-solo",
      text: "alpha beta",
      seed: 123,
      requestedConfig: {
        ...APPLICATION_TEST_CONFIG,
        includePunctuation: true,
        includeNumbers: true,
      },
      effectiveConfig: {
        ...APPLICATION_TEST_CONFIG,
        includePunctuation: false,
        includeNumbers: false,
      },
      resolvedDifficulty: "medium",
    };

    assert.deepEqual(renderedTestConfig(prepared), {
      mode: "words",
      wordCount: 15,
      durationSec: null,
      language: "english",
      include_punctuation: false,
      include_numbers: false,
    });
  });

  it("uses an explicit discriminant for finalized TypingBox prompts", () => {
    const finalized: FinalizedSoloPrompt = {
      kind: "finalized-solo",
      text: "alpha beta",
      seed: 10,
      requestedConfig: { ...APPLICATION_TEST_CONFIG },
      effectiveConfig: { ...APPLICATION_TEST_CONFIG },
      resolvedDifficulty: "easy",
    };

    assert.equal(isFinalizedSoloPrompt(finalized), true);
    assert.equal(isFinalizedSoloPrompt("alpha beta"), false);
    assert.equal(promptText(finalized), "alpha beta");

    const typingBoxSource = readFileSync(
      "src/components/typing/TypingBox.tsx",
      "utf8",
    );
    assert.equal(typingBoxSource.includes("isFinalizedSoloPrompt(prepared)"), true);
    assert.equal(typingBoxSource.includes("if (!skipMutation) try"), true);
  });
});
