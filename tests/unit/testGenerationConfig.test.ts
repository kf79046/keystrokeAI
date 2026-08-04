import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APPLICATION_TEST_CONFIG,
  normalizeTestGenerationConfig,
  resolveInitialTestConfig,
} from "../../src/lib/prompt/testGenerationConfig";

describe("test generation configuration", () => {
  it("initializes from application defaults", () => {
    assert.deepEqual(resolveInitialTestConfig(), APPLICATION_TEST_CONFIG);
  });

  it("initializes from persisted defaults when no later source exists", () => {
    const config = resolveInitialTestConfig({
      persistedDefaults: {
        wordCount: 30,
        includePunctuation: true,
        includeNumbers: true,
        wordSet: "core1000",
        maxRepeatPerWord: 3,
      },
    });

    assert.equal(config.wordCount, 30);
    assert.equal(config.includePunctuation, true);
    assert.equal(config.includeNumbers, true);
    assert.equal(config.wordSet, "core1000");
    assert.equal(config.maxRepeatPerWord, 3);
  });

  it("lets a valid last-used config override persisted defaults", () => {
    const config = resolveInitialTestConfig({
      persistedDefaults: {
        wordCount: 30,
        includePunctuation: false,
      },
      lastUsed: {
        wordCount: 20,
        includePunctuation: true,
      },
    });

    assert.equal(config.wordCount, 20);
    assert.equal(config.includePunctuation, true);
  });

  it("lets an explicit restart override all initialized sources", () => {
    const config = resolveInitialTestConfig({
      persistedDefaults: { wordCount: 30 },
      lastUsed: { wordCount: 20 },
      explicitOverride: {
        wordCount: 10,
        includeNumbers: true,
      },
    });

    assert.equal(config.wordCount, 10);
    assert.equal(config.includeNumbers, true);
  });

  it("skips an invalid persisted source", () => {
    const config = resolveInitialTestConfig({
      persistedDefaults: {
        wordCount: 999,
        includePunctuation: true,
      },
    });

    assert.deepEqual(config, APPLICATION_TEST_CONFIG);
  });

  it("rejects an invalid explicit override", () => {
    assert.throws(
      () => resolveInitialTestConfig({
        explicitOverride: { seed: -1 },
      }),
      /seed must be an integer/,
    );
  });

  it("returns an immutable snapshot independent of later defaults", () => {
    const persisted = { includePunctuation: true };
    const config = resolveInitialTestConfig({ persistedDefaults: persisted });
    persisted.includePunctuation = false;

    assert.equal(config.includePunctuation, true);
    assert.equal(Object.isFrozen(config), true);
  });

  it("keeps time and words dimensions mutually exclusive", () => {
    const config = normalizeTestGenerationConfig({
      mode: "time",
      durationSeconds: 60,
    });

    assert.equal(config.mode, "time");
    assert.equal(config.durationSeconds, 60);
    assert.equal("wordCount" in config, false);
  });
});
