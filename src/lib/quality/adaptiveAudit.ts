import { applyEasyFilter } from "@/lib/prompt/easyFilter";
import { sanitizePrompt } from "@/lib/prompt/sanitize";
import { mulberry32 } from "@/lib/prng";
import {
  compareAdaptiveStages,
  inspectAdaptiveContent,
  reproducibilityViolation,
  validateAdaptiveSample,
  type AdaptiveAuditStage,
  type AdaptiveContentMetrics,
  type AdaptiveFlags,
  type AdaptiveViolation,
  type AdaptiveViolationCode,
} from "@/lib/quality/adaptiveValidator";
import { getEasyPoolSync } from "@/lib/wordbanks/easyPool";
import { generatePrompt } from "@/server/generatePrompt";

export const ADAPTIVE_FLAG_MATRIX: readonly AdaptiveFlags[] = [
  { punctuation: false, numbers: false },
  { punctuation: true, numbers: false },
  { punctuation: false, numbers: true },
  { punctuation: true, numbers: true },
];

export const DEFAULT_ADAPTIVE_AUDIT_SEEDS = [101, 202, 303, 404] as const;
export const DEFAULT_DOWNSTREAM_SETTINGS_FLAGS: AdaptiveFlags = {
  punctuation: false,
  numbers: false,
};

export type AdaptiveAuditObservation = {
  stage: AdaptiveAuditStage;
  seed: number;
  requestedFlags: AdaptiveFlags;
  effectiveFlags: AdaptiveFlags;
  difficulty: "easy" | "medium" | "hard";
  text: string;
  metrics: AdaptiveContentMetrics;
  violations: AdaptiveViolation[];
};

export type AdaptiveAuditReport = {
  schemaVersion: 1;
  policy: {
    disabled: "forbidden";
    enabled: "allowed";
  };
  wordCount: number;
  seeds: number[];
  configurations: AdaptiveFlags[];
  downstreamSettingsFlags: AdaptiveFlags;
  samplesGenerated: number;
  observations: AdaptiveAuditObservation[];
  inclusion: Record<AdaptiveAuditStage, {
    punctuationSamples: number;
    numberSamples: number;
  }>;
  summary: {
    passedObservations: number;
    failedObservations: number;
    totalViolations: number;
    byCode: Partial<Record<AdaptiveViolationCode, number>>;
  };
};

export type RunAdaptiveAuditOptions = {
  seeds?: readonly number[];
  wordCount?: number;
  downstreamSettingsFlags?: AdaptiveFlags;
};

function deterministicFilterRandom(seed: number) {
  return mulberry32((seed ^ 0x9e3779b9) >>> 0);
}

function runCurrentDownstreamStage(input: {
  text: string;
  seed: number;
  easyPool: string[];
  settingsFlags: AdaptiveFlags;
}): { text: string; violations: AdaptiveViolation[] } {
  let filtered = input.text;
  const violations: AdaptiveViolation[] = [];

  try {
    filtered = applyEasyFilter(input.text, input.easyPool, {
      maxLen: 8,
      maxRepeat: 2,
      random: deterministicFilterRandom(input.seed),
    });
  } catch (error) {
    violations.push({
      code: "DOWNSTREAM_STAGE_ERROR",
      stage: "downstream",
      message: "The easy-filter stage threw and the current caller kept the prior text.",
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  return {
    text: sanitizePrompt(filtered, {
      allowPunctuation: input.settingsFlags.punctuation,
      allowNumbers: input.settingsFlags.numbers,
    }),
    violations,
  };
}

function createObservation(input: {
  stage: AdaptiveAuditStage;
  seed: number;
  requestedFlags: AdaptiveFlags;
  effectiveFlags: AdaptiveFlags;
  difficulty: "easy" | "medium" | "hard";
  text: string;
  expectedWordCount: number;
  extraViolations?: AdaptiveViolation[];
}): AdaptiveAuditObservation {
  const violations = [
    ...validateAdaptiveSample({
      stage: input.stage,
      text: input.text,
      requestedFlags: input.requestedFlags,
      effectiveFlags: input.effectiveFlags,
      expectedWordCount: input.expectedWordCount,
    }),
    ...(input.extraViolations ?? []),
  ];

  return {
    stage: input.stage,
    seed: input.seed,
    requestedFlags: input.requestedFlags,
    effectiveFlags: input.effectiveFlags,
    difficulty: input.difficulty,
    text: input.text,
    metrics: inspectAdaptiveContent(input.text),
    violations,
  };
}

export async function runAdaptiveAudit(
  options: RunAdaptiveAuditOptions = {},
): Promise<AdaptiveAuditReport> {
  const seeds = [...(options.seeds ?? DEFAULT_ADAPTIVE_AUDIT_SEEDS)];
  const wordCount = options.wordCount ?? 15;
  const downstreamSettingsFlags = {
    ...(options.downstreamSettingsFlags ?? DEFAULT_DOWNSTREAM_SETTINGS_FLAGS),
  };
  const observations: AdaptiveAuditObservation[] = [];
  const easyPool = getEasyPoolSync(8);

  for (const requestedFlags of ADAPTIVE_FLAG_MATRIX) {
    for (const seed of seeds) {
      const input = {
        mode: "words" as const,
        count: wordCount,
        difficulty: "auto" as const,
        recent_wpm: 50,
        recent_accuracy: 95,
        include_punctuation: requestedFlags.punctuation,
        include_numbers: requestedFlags.numbers,
        seed,
      };

      const raw = await generatePrompt(input);
      const rawReplay = await generatePrompt(input);
      const effectiveFlags = { ...raw.flags };

      observations.push(createObservation({
        stage: "generator",
        seed,
        requestedFlags,
        effectiveFlags,
        difficulty: raw.difficulty,
        text: raw.text,
        expectedWordCount: wordCount,
        extraViolations: reproducibilityViolation(
          "generator",
          raw.text,
          rawReplay.text,
        ),
      }));

      const downstream = runCurrentDownstreamStage({
        text: raw.text,
        seed,
        easyPool,
        settingsFlags: downstreamSettingsFlags,
      });
      const downstreamReplay = runCurrentDownstreamStage({
        text: rawReplay.text,
        seed,
        easyPool,
        settingsFlags: downstreamSettingsFlags,
      });

      observations.push(createObservation({
        stage: "downstream",
        seed,
        requestedFlags,
        effectiveFlags: downstreamSettingsFlags,
        difficulty: raw.difficulty,
        text: downstream.text,
        expectedWordCount: wordCount,
        extraViolations: [
          ...downstream.violations,
          ...compareAdaptiveStages(raw.text, downstream.text, requestedFlags),
          ...reproducibilityViolation(
            "downstream",
            downstream.text,
            downstreamReplay.text,
          ),
        ],
      }));
    }
  }

  const byCode: Partial<Record<AdaptiveViolationCode, number>> = {};
  for (const violation of observations.flatMap((item) => item.violations)) {
    byCode[violation.code] = (byCode[violation.code] ?? 0) + 1;
  }

  const inclusion = {
    generator: { punctuationSamples: 0, numberSamples: 0 },
    downstream: { punctuationSamples: 0, numberSamples: 0 },
  } satisfies AdaptiveAuditReport["inclusion"];

  for (const observation of observations) {
    if (observation.metrics.hasPunctuation) {
      inclusion[observation.stage].punctuationSamples += 1;
    }
    if (observation.metrics.hasDigits) {
      inclusion[observation.stage].numberSamples += 1;
    }
  }

  const failedObservations = observations.filter(
    (observation) => observation.violations.length > 0,
  ).length;
  const totalViolations = Object.values(byCode).reduce(
    (total, count) => total + (count ?? 0),
    0,
  );

  return {
    schemaVersion: 1,
    policy: {
      disabled: "forbidden",
      enabled: "allowed",
    },
    wordCount,
    seeds,
    configurations: ADAPTIVE_FLAG_MATRIX.map((flags) => ({ ...flags })),
    downstreamSettingsFlags,
    samplesGenerated: ADAPTIVE_FLAG_MATRIX.length * seeds.length,
    observations,
    inclusion,
    summary: {
      passedObservations: observations.length - failedObservations,
      failedObservations,
      totalViolations,
      byCode,
    },
  };
}
