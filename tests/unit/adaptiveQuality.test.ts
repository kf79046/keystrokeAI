import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADAPTIVE_FLAG_MATRIX,
  runAdaptiveAudit,
} from "../../src/lib/quality/adaptiveAudit";
import {
  inspectAdaptiveContent,
  validateAdaptiveSample,
} from "../../src/lib/quality/adaptiveValidator";
import { generatePrompt } from "../../src/server/generatePrompt";

describe("adaptive validator policy", () => {
  it("treats disabled punctuation and numbers as hard invariants", () => {
    const violations = validateAdaptiveSample({
      stage: "generator",
      text: "alpha, beta 42",
      requestedFlags: { punctuation: false, numbers: false },
      effectiveFlags: { punctuation: false, numbers: false },
      expectedWordCount: 3,
    });

    assert.deepEqual(
      violations.map((violation) => violation.code),
      ["UNEXPECTED_PUNCTUATION", "UNEXPECTED_DIGITS"],
    );
  });

  it("requires enabled punctuation and numbers to be visible", () => {
    const violations = validateAdaptiveSample({
      stage: "generator",
      text: "alpha beta gamma",
      requestedFlags: { punctuation: true, numbers: true },
      effectiveFlags: { punctuation: true, numbers: true },
      expectedWordCount: 3,
    });

    assert.deepEqual(
      violations.map((violation) => violation.code),
      ["REQUIRED_PUNCTUATION_MISSING", "REQUIRED_NUMBERS_MISSING"],
    );
  });

  it("reports count and effective-flag mismatches with stable codes", () => {
    const violations = validateAdaptiveSample({
      stage: "generator",
      text: "alpha beta",
      requestedFlags: { punctuation: true, numbers: false },
      effectiveFlags: { punctuation: false, numbers: false },
      expectedWordCount: 3,
    });

    assert.deepEqual(
      violations.map((violation) => violation.code),
      [
        "WORD_COUNT_MISMATCH",
        "REQUIRED_PUNCTUATION_MISSING",
        "EFFECTIVE_FLAG_MISMATCH",
      ],
    );
  });
});

describe("deterministic TypeScript generator seam", () => {
  for (const includePunctuation of [false, true]) {
    for (const includeNumbers of [false, true]) {
      it(`honors punctuation=${includePunctuation} numbers=${includeNumbers}`, async () => {
        const generated = await generatePrompt({
          mode: "words",
          count: 15,
          difficulty: "auto",
          recent_wpm: 50,
          recent_accuracy: 95,
          include_punctuation: includePunctuation,
          include_numbers: includeNumbers,
          seed: 4242,
        });
        const metrics = inspectAdaptiveContent(generated.text);

        assert.deepEqual(generated.flags, {
          punctuation: includePunctuation,
          numbers: includeNumbers,
        });
        assert.equal(metrics.hasPunctuation, includePunctuation);
        assert.equal(metrics.hasDigits, includeNumbers);
      });
    }
  }

  it("replays identical local output for the same seed and configuration", async () => {
    const input = {
      mode: "words" as const,
      count: 15,
      difficulty: "auto" as const,
      recent_wpm: 50,
      recent_accuracy: 95,
      include_punctuation: true,
      include_numbers: true,
      seed: 123456,
    };

    const first = await generatePrompt(input);
    const replay = await generatePrompt(input);

    assert.deepEqual(replay, first);
  });

  it("keeps explicit disabled flags authoritative at hard difficulty", async () => {
    const generated = await generatePrompt({
      mode: "words",
      count: 15,
      difficulty: "hard",
      include_punctuation: false,
      include_numbers: false,
      seed: 99,
    });
    const metrics = inspectAdaptiveContent(generated.text);

    assert.deepEqual(generated.flags, { punctuation: false, numbers: false });
    assert.equal(metrics.hasPunctuation, false);
    assert.equal(metrics.hasDigits, false);
  });

  it("rejects invalid caller-supplied seeds", async () => {
    await assert.rejects(
      generatePrompt({ seed: -1 }),
      /seed must be an integer/,
    );
  });
});

describe("adaptive quality audit characterization", () => {
  it("covers the complete punctuation and number matrix", async () => {
    const report = await runAdaptiveAudit({ seeds: [7], wordCount: 15 });

    assert.deepEqual(report.configurations, ADAPTIVE_FLAG_MATRIX);
    assert.equal(report.samplesGenerated, 4);
    assert.equal(report.observations.length, 8);
  });

  it("passes the generator and shared production finalizer in strict mode", async () => {
    const report = await runAdaptiveAudit({
      seeds: [101, 202, 303, 404],
      wordCount: 15,
    });
    const generatorObservations = report.observations.filter(
      (observation) => observation.stage === "generator",
    );

    assert.equal(
      generatorObservations.every(
        (observation) => observation.violations.length === 0,
      ),
      true,
    );
    assert.equal(
      report.observations.every(
        (observation) => observation.violations.length === 0,
      ),
      true,
    );
    assert.equal(report.summary.totalViolations, 0);
    assert.equal(report.inclusion.generator.punctuationSamples, 8);
    assert.equal(report.inclusion.generator.numberSamples, 8);
    assert.equal(report.inclusion.downstream.punctuationSamples, 8);
    assert.equal(report.inclusion.downstream.numberSamples, 8);
  });
});
