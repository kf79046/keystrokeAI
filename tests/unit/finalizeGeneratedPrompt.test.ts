import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { StringLRU } from "../../src/lib/lru";
import { applyEasyFilter } from "../../src/lib/prompt/easyFilter";
import {
  finalizeGeneratedPrompt,
  PromptFinalizationError,
} from "../../src/lib/prompt/finalizeGeneratedPrompt";
import {
  APPLICATION_TEST_CONFIG,
  type TestGenerationConfig,
} from "../../src/lib/prompt/testGenerationConfig";
import { inspectAdaptiveContent } from "../../src/lib/quality/adaptiveValidator";
import { EN_CORE_5K } from "../../src/lib/wordbanks/en_core_5k";

const WORD_COUNT = 15;
const RAW = "Alpha, beta 42 gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi.";

function config(
  includePunctuation: boolean,
  includeNumbers: boolean,
): TestGenerationConfig {
  return {
    ...APPLICATION_TEST_CONFIG,
    wordCount: WORD_COUNT,
    includePunctuation,
    includeNumbers,
    seed: 12345,
  };
}

describe("shared generated-prompt finalization", () => {
  for (const includePunctuation of [false, true]) {
    for (const includeNumbers of [false, true]) {
      it(`enforces punctuation=${includePunctuation} numbers=${includeNumbers}`, () => {
        const result = finalizeGeneratedPrompt({
          rawText: RAW,
          config: config(includePunctuation, includeNumbers),
          expectedTokenCount: WORD_COUNT,
          wordPool: EN_CORE_5K,
        });
        const metrics = inspectAdaptiveContent(result.text);

        assert.equal(metrics.wordCount, WORD_COUNT);
        assert.equal(metrics.hasPunctuation, includePunctuation);
        assert.equal(metrics.hasDigits, includeNumbers);
        assert.equal(
          result.effectiveConfig.includePunctuation,
          includePunctuation,
        );
        assert.equal(result.effectiveConfig.includeNumbers, includeNumbers);
      });
    }
  }

  it("adds enabled content deterministically when raw text omits it", () => {
    const input = {
      rawText: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
      config: config(true, true),
      expectedTokenCount: WORD_COUNT,
      wordPool: EN_CORE_5K,
    };

    const first = finalizeGeneratedPrompt(input);
    const replay = finalizeGeneratedPrompt(input);

    assert.equal(replay.text, first.text);
    assert.equal(inspectAdaptiveContent(first.text).hasPunctuation, true);
    assert.equal(inspectAdaptiveContent(first.text).hasDigits, true);
  });

  it("replaces malformed tokens without reducing token count", () => {
    const result = finalizeGeneratedPrompt({
      rawText: "!!! 123 supercalifragilistic",
      config: config(false, false),
      expectedTokenCount: WORD_COUNT,
      wordPool: EN_CORE_5K,
    });
    const metrics = inspectAdaptiveContent(result.text);

    assert.equal(metrics.wordCount, WORD_COUNT);
    assert.equal(metrics.hasPunctuation, false);
    assert.equal(metrics.hasDigits, false);
    assert.equal(result.text.split(/\s+/).every((token) => /^[a-z]{1,8}$/.test(token)), true);
  });

  it("honors repeat limits across an existing timed stream and append", () => {
    const timedConfig: TestGenerationConfig = {
      ...config(false, false),
      mode: "time",
      wordCount: undefined,
      durationSeconds: 30,
      maxRepeatPerWord: 2,
    };
    const priorTokens = ["alpha", "alpha"];
    const result = finalizeGeneratedPrompt({
      rawText: Array(15).fill("alpha").join(" "),
      config: timedConfig,
      expectedTokenCount: 15,
      wordPool: EN_CORE_5K,
      priorTokens,
    });
    const combined = priorTokens.concat(result.text.split(/\s+/));
    const counts = new Map<string, number>();
    for (const token of combined) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    assert.equal(result.text.split(/\s+/).length, 15);
    assert.equal(Math.max(...counts.values()), 2);
  });

  it("fails clearly for empty input", () => {
    assert.throws(
      () => finalizeGeneratedPrompt({
        rawText: " ",
        config: config(false, false),
        expectedTokenCount: WORD_COUNT,
        wordPool: EN_CORE_5K,
      }),
      (error) => (
        error instanceof PromptFinalizationError &&
        error.code === "EMPTY_RAW_TEXT"
      ),
    );
  });

  it("uses the public StringLRU.push API during easy filtering", () => {
    const original = StringLRU.prototype.push;
    let calls = 0;
    StringLRU.prototype.push = function instrumentedPush(value: string) {
      calls += 1;
      return original.call(this, value);
    };

    try {
      const output = applyEasyFilter("alpha difficultword beta", EN_CORE_5K, {
        random: () => 0.25,
      });
      assert.equal(output.split(/\s+/).length, 3);
      assert.equal(calls, 3);
    } finally {
      StringLRU.prototype.push = original;
    }
  });

  it("has no hidden Zustand settings dependency", () => {
    const source = readFileSync(
      "src/lib/prompt/finalizeGeneratedPrompt.ts",
      "utf8",
    );
    assert.equal(source.includes("useSettingsStore"), false);
    assert.equal(source.includes("@/store/settings"), false);
  });
});
