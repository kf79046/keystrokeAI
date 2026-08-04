import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateTimeFallback,
  generateWordFallback,
} from "../../src/lib/prompt/localFallback";
import {
  APPLICATION_TEST_CONFIG,
  type TestGenerationConfig,
} from "../../src/lib/prompt/testGenerationConfig";
import { inspectAdaptiveContent } from "../../src/lib/quality/adaptiveValidator";
import { EN_CORE_200 } from "../../src/lib/wordbanks";

function wordConfig(
  punctuation: boolean,
  numbers: boolean,
): TestGenerationConfig {
  return {
    ...APPLICATION_TEST_CONFIG,
    mode: "words",
    wordCount: 15,
    includePunctuation: punctuation,
    includeNumbers: numbers,
    wordSet: "core200",
    seed: 707,
  };
}

function timeConfig(
  punctuation: boolean,
  numbers: boolean,
): TestGenerationConfig {
  return {
    ...APPLICATION_TEST_CONFIG,
    mode: "time",
    wordCount: undefined,
    durationSeconds: 30,
    includePunctuation: punctuation,
    includeNumbers: numbers,
    wordSet: "core200",
    seed: 808,
  };
}

describe("local fallback parity", () => {
  for (const punctuation of [false, true]) {
    for (const numbers of [false, true]) {
      it(`word fallback honors punctuation=${punctuation} numbers=${numbers}`, () => {
        const input = {
          config: wordConfig(punctuation, numbers),
          wordPool: EN_CORE_200,
        };
        const first = generateWordFallback(input);
        const replay = generateWordFallback(input);
        const metrics = inspectAdaptiveContent(first.text);

        assert.equal(replay.text, first.text);
        assert.equal(metrics.wordCount, 15);
        assert.equal(metrics.hasPunctuation, punctuation);
        assert.equal(metrics.hasDigits, numbers);
      });

      it(`time fallback honors punctuation=${punctuation} numbers=${numbers}`, () => {
        const input = {
          config: timeConfig(punctuation, numbers),
          wordPool: EN_CORE_200,
        };
        const first = generateTimeFallback(input);
        const replay = generateTimeFallback(input);
        const metrics = inspectAdaptiveContent(first.text);

        assert.equal(replay.text, first.text);
        assert.equal(metrics.wordCount, 200);
        assert.equal(metrics.hasPunctuation, punctuation);
        assert.equal(metrics.hasDigits, numbers);
      });
    }
  }
});
