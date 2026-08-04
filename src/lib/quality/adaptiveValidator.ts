export type AdaptiveFlags = {
  punctuation: boolean;
  numbers: boolean;
};

export type AdaptiveAuditStage = "generator" | "downstream";

export type AdaptiveViolationCode =
  | "EMPTY_OUTPUT"
  | "WORD_COUNT_MISMATCH"
  | "UNEXPECTED_PUNCTUATION"
  | "UNEXPECTED_DIGITS"
  | "REQUIRED_PUNCTUATION_MISSING"
  | "REQUIRED_NUMBERS_MISSING"
  | "EFFECTIVE_FLAG_MISMATCH"
  | "REPRODUCIBILITY_MISMATCH"
  | "DOWNSTREAM_STAGE_ERROR"
  | "PUNCTUATION_LOST_DOWNSTREAM"
  | "NUMBERS_LOST_DOWNSTREAM";

export type AdaptiveViolation = {
  code: AdaptiveViolationCode;
  stage: AdaptiveAuditStage;
  message: string;
  details?: Record<string, unknown>;
};

export type AdaptiveContentMetrics = {
  wordCount: number;
  digitCount: number;
  punctuationCount: number;
  hasDigits: boolean;
  hasPunctuation: boolean;
};

export type AdaptiveSampleInput = {
  stage: AdaptiveAuditStage;
  text: string;
  requestedFlags: AdaptiveFlags;
  effectiveFlags: AdaptiveFlags;
  expectedWordCount: number;
};

const DIGIT_RE = /[0-9]/;
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/u;

export function inspectAdaptiveContent(text: string): AdaptiveContentMetrics {
  const value = String(text ?? "");
  const characters = Array.from(value);
  const digitCount = characters.filter((char) => DIGIT_RE.test(char)).length;
  const punctuationCount = characters.filter((char) => PUNCTUATION_RE.test(char)).length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  return {
    wordCount,
    digitCount,
    punctuationCount,
    hasDigits: digitCount > 0,
    hasPunctuation: punctuationCount > 0,
  };
}

export function validateAdaptiveSample(input: AdaptiveSampleInput): AdaptiveViolation[] {
  const metrics = inspectAdaptiveContent(input.text);
  const violations: AdaptiveViolation[] = [];

  if (!String(input.text ?? "").trim()) {
    violations.push({
      code: "EMPTY_OUTPUT",
      stage: input.stage,
      message: "Generated text is empty.",
    });
  }

  if (metrics.wordCount !== input.expectedWordCount) {
    violations.push({
      code: "WORD_COUNT_MISMATCH",
      stage: input.stage,
      message: "Generated text does not contain the requested number of tokens.",
      details: {
        expected: input.expectedWordCount,
        actual: metrics.wordCount,
      },
    });
  }

  if (!input.requestedFlags.punctuation && metrics.hasPunctuation) {
    violations.push({
      code: "UNEXPECTED_PUNCTUATION",
      stage: input.stage,
      message: "Punctuation appeared while punctuation was disabled.",
      details: { punctuationCount: metrics.punctuationCount },
    });
  }

  if (!input.requestedFlags.numbers && metrics.hasDigits) {
    violations.push({
      code: "UNEXPECTED_DIGITS",
      stage: input.stage,
      message: "Digits appeared while numbers were disabled.",
      details: { digitCount: metrics.digitCount },
    });
  }

  if (input.requestedFlags.punctuation && !metrics.hasPunctuation) {
    violations.push({
      code: "REQUIRED_PUNCTUATION_MISSING",
      stage: input.stage,
      message: "Punctuation was enabled but no punctuation is visible.",
    });
  }

  if (input.requestedFlags.numbers && !metrics.hasDigits) {
    violations.push({
      code: "REQUIRED_NUMBERS_MISSING",
      stage: input.stage,
      message: "Numbers were enabled but no digits are visible.",
    });
  }

  if (
    input.effectiveFlags.punctuation !== input.requestedFlags.punctuation ||
    input.effectiveFlags.numbers !== input.requestedFlags.numbers
  ) {
    violations.push({
      code: "EFFECTIVE_FLAG_MISMATCH",
      stage: input.stage,
      message: "The generator's effective flags differ from the explicit request.",
      details: {
        requested: input.requestedFlags,
        effective: input.effectiveFlags,
      },
    });
  }

  return violations;
}

export function compareAdaptiveStages(
  rawText: string,
  downstreamText: string,
  flags: AdaptiveFlags,
): AdaptiveViolation[] {
  const raw = inspectAdaptiveContent(rawText);
  const downstream = inspectAdaptiveContent(downstreamText);
  const violations: AdaptiveViolation[] = [];

  if (flags.punctuation && raw.hasPunctuation && !downstream.hasPunctuation) {
    violations.push({
      code: "PUNCTUATION_LOST_DOWNSTREAM",
      stage: "downstream",
      message: "Punctuation present in generator output was removed downstream.",
      details: {
        generatorCount: raw.punctuationCount,
        downstreamCount: downstream.punctuationCount,
      },
    });
  }

  if (flags.numbers && raw.hasDigits && !downstream.hasDigits) {
    violations.push({
      code: "NUMBERS_LOST_DOWNSTREAM",
      stage: "downstream",
      message: "Digits present in generator output were removed downstream.",
      details: {
        generatorCount: raw.digitCount,
        downstreamCount: downstream.digitCount,
      },
    });
  }

  return violations;
}

export function reproducibilityViolation(
  stage: AdaptiveAuditStage,
  first: string,
  replay: string,
): AdaptiveViolation[] {
  if (first === replay) return [];
  return [{
    code: "REPRODUCIBILITY_MISMATCH",
    stage,
    message: "The same local seed and configuration produced different text.",
  }];
}
