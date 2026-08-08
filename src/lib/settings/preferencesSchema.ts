import type { WordSetKey } from "@/lib/wordbanks";
import {
  APPLICATION_TEST_CONFIG,
  WORD_TEST_COUNTS,
  type WordTestCount,
} from "@/lib/prompt/testGenerationConfig";

export const PREFERENCES_SCHEMA_VERSION = 1 as const;

export type CmdMode = "hidden" | "peek" | "full";
export type CmdDock = "br" | "bl" | "tr" | "tl";
export type SettingsTestMode = "words" | "time" | "quote" | "custom" | "coder";

export type AppearanceSettings = {
  theme?: "system" | "light" | "dark";
  accent: {
    preset: "blaze" | "ember" | "magma" | "plasma" | "aurora" | "custom";
    h: number;
    s: number;
    l: number;
  };
  background: {
    flames: "off" | "subtle" | "dynamic";
    sparks: boolean;
    vignette: boolean;
  };
  glass: { blurPx: number; alpha: number };
  cards: { radius: 12 | 16 | 20 | 24; glow: "off" | "soft" | "strong" };
  density: "comfortable" | "compact";
  type: {
    scale: 0.9 | 1 | 1.05 | 1.1;
    family: "system" | "inter" | "jetbrains" | "monaspace";
  };
  caret: {
    style: "bar" | "underline" | "block";
    blinkMs: number;
    color: "accent" | "white";
    smoothCaret: "off" | "fast" | "medium" | "slow";
  };
  motion: { reduce: boolean };
  contrast: { high: boolean };
  charts: { glow: "off" | "ember" };
};

export type SettingsData = {
  commands: {
    defaultMode: CmdMode;
    defaultDock: CmdDock;
    autoShowOnResults: boolean;
    autoPeekDelayMs: number;
  };
  test: {
    defaultMode: SettingsTestMode;
    defaultLength: WordTestCount;
    wordSet: WordSetKey;
    include_numbers: boolean;
    include_punctuation: boolean;
    maxRepeatPerWord?: number;
    stopOnError: boolean;
    strictSpace: boolean;
    blazeModeEnabled: boolean;
  };
  ai: {
    coachEnabled: boolean;
    includeDigraphs: boolean;
    intensity: "low" | "med" | "high";
  };
  fx: {
    fxEnabled: boolean;
    fxIntensity: "low" | "med" | "high";
  };
  focus: {
    enabled: boolean;
    exitOnMouseMove: boolean;
    blurWarning: boolean;
  };
  appearance: AppearanceSettings;
  privacy: {
    publicProfile: boolean;
    shareRunsByDefault: boolean;
  };
};

export type PersistedPreferences = SettingsData & {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION;
};

/**
 * The one application-default source for the settings store, local cache, and
 * server schema. Test defaults continue to derive from Phase 2's canonical
 * TestGenerationConfig.
 */
export const APPLICATION_SETTINGS_DEFAULTS: Readonly<SettingsData> = {
  commands: {
    defaultMode: "peek",
    defaultDock: "br",
    autoShowOnResults: true,
    autoPeekDelayMs: 8000,
  },
  test: {
    defaultMode: APPLICATION_TEST_CONFIG.mode,
    defaultLength: APPLICATION_TEST_CONFIG.wordCount as WordTestCount,
    wordSet: APPLICATION_TEST_CONFIG.wordSet,
    include_numbers: APPLICATION_TEST_CONFIG.includeNumbers,
    include_punctuation: APPLICATION_TEST_CONFIG.includePunctuation,
    maxRepeatPerWord: APPLICATION_TEST_CONFIG.maxRepeatPerWord,
    stopOnError: false,
    strictSpace: false,
    blazeModeEnabled: false,
  },
  ai: {
    coachEnabled: true,
    includeDigraphs: true,
    intensity: "med",
  },
  fx: {
    fxEnabled: true,
    fxIntensity: "med",
  },
  focus: {
    enabled: true,
    exitOnMouseMove: false,
    blurWarning: true,
  },
  appearance: {
    theme: "system",
    accent: { preset: "blaze", h: 24, s: 95, l: 55 },
    background: { flames: "subtle", sparks: true, vignette: true },
    glass: { blurPx: 12, alpha: 0.14 },
    cards: { radius: 20, glow: "soft" },
    density: "comfortable",
    type: { scale: 1, family: "inter" },
    caret: {
      style: "bar",
      blinkMs: 750,
      color: "accent",
      smoothCaret: "medium",
    },
    motion: { reduce: false },
    contrast: { high: false },
    charts: { glow: "ember" },
  },
  privacy: {
    publicProfile: false,
    shareRunsByDefault: false,
  },
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function enumValue<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < minimum || value > maximum) return fallback;
  return integer ? Math.floor(value) : value;
}

function sourceRecord(raw: unknown): UnknownRecord {
  const outer = record(raw);
  if (isRecord(outer.preferences)) return outer.preferences;
  if (isRecord(outer.state)) return outer.state;
  return outer;
}

function cloneSettingsData(data: SettingsData): SettingsData {
  return {
    commands: { ...data.commands },
    test: { ...data.test },
    ai: { ...data.ai },
    fx: { ...data.fx },
    focus: { ...data.focus },
    appearance: {
      ...data.appearance,
      accent: { ...data.appearance.accent },
      background: { ...data.appearance.background },
      glass: { ...data.appearance.glass },
      cards: { ...data.appearance.cards },
      type: { ...data.appearance.type },
      caret: { ...data.appearance.caret },
      motion: { ...data.appearance.motion },
      contrast: { ...data.appearance.contrast },
      charts: { ...data.appearance.charts },
    },
    privacy: { ...data.privacy },
  };
}

export function applicationSettingsDefaults(): SettingsData {
  return cloneSettingsData(APPLICATION_SETTINGS_DEFAULTS as SettingsData);
}

export function normalizePreferences(raw: unknown): PersistedPreferences {
  const defaults = applicationSettingsDefaults();
  const source = sourceRecord(raw);
  const commands = record(source.commands);
  const test = record(source.test);
  const ai = record(source.ai);
  const fx = record(source.fx);
  const focus = record(source.focus);
  const appearance = record(source.appearance);
  const accent = record(appearance.accent);
  const background = record(appearance.background);
  const glass = record(appearance.glass);
  const cards = record(appearance.cards);
  const type = record(appearance.type);
  const caret = record(appearance.caret);
  const motion = record(appearance.motion);
  const contrast = record(appearance.contrast);
  const charts = record(appearance.charts);
  const privacy = record(source.privacy);

  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    commands: {
      defaultMode: enumValue(
        commands.defaultMode,
        ["hidden", "peek", "full"] as const,
        defaults.commands.defaultMode,
      ),
      defaultDock: enumValue(
        commands.defaultDock,
        ["br", "bl", "tr", "tl"] as const,
        defaults.commands.defaultDock,
      ),
      autoShowOnResults: booleanValue(
        commands.autoShowOnResults,
        defaults.commands.autoShowOnResults,
      ),
      autoPeekDelayMs: numberValue(
        commands.autoPeekDelayMs,
        defaults.commands.autoPeekDelayMs,
        2000,
        20000,
        true,
      ),
    },
    test: {
      defaultMode: enumValue(
        test.defaultMode,
        ["words", "time", "quote", "custom", "coder"] as const,
        defaults.test.defaultMode,
      ),
      defaultLength: enumValue(
        Number(test.defaultLength),
        WORD_TEST_COUNTS,
        defaults.test.defaultLength,
      ),
      wordSet: enumValue(
        test.wordSet,
        ["core200", "core1000", "core5000"] as const,
        defaults.test.wordSet,
      ),
      include_numbers: booleanValue(
        test.include_numbers ?? test.includeNumbers,
        defaults.test.include_numbers,
      ),
      include_punctuation: booleanValue(
        test.include_punctuation ?? test.includePunctuation,
        defaults.test.include_punctuation,
      ),
      maxRepeatPerWord: numberValue(
        test.maxRepeatPerWord ?? test.max_repeat_per_word,
        defaults.test.maxRepeatPerWord ?? 2,
        1,
        5,
        true,
      ),
      stopOnError: booleanValue(test.stopOnError, defaults.test.stopOnError),
      strictSpace: booleanValue(test.strictSpace, defaults.test.strictSpace),
      blazeModeEnabled: booleanValue(
        test.blazeModeEnabled,
        defaults.test.blazeModeEnabled,
      ),
    },
    ai: {
      coachEnabled: booleanValue(ai.coachEnabled, defaults.ai.coachEnabled),
      includeDigraphs: booleanValue(
        ai.includeDigraphs,
        defaults.ai.includeDigraphs,
      ),
      intensity: enumValue(
        ai.intensity,
        ["low", "med", "high"] as const,
        defaults.ai.intensity,
      ),
    },
    fx: {
      fxEnabled: booleanValue(fx.fxEnabled, defaults.fx.fxEnabled),
      fxIntensity: enumValue(
        fx.fxIntensity,
        ["low", "med", "high"] as const,
        defaults.fx.fxIntensity,
      ),
    },
    focus: {
      enabled: booleanValue(focus.enabled, defaults.focus.enabled),
      exitOnMouseMove: booleanValue(
        focus.exitOnMouseMove,
        defaults.focus.exitOnMouseMove,
      ),
      blurWarning: booleanValue(focus.blurWarning, defaults.focus.blurWarning),
    },
    appearance: {
      theme: enumValue(
        appearance.theme,
        ["system", "light", "dark"] as const,
        defaults.appearance.theme ?? "system",
      ),
      accent: {
        preset: enumValue(
          accent.preset,
          ["blaze", "ember", "magma", "plasma", "aurora", "custom"] as const,
          defaults.appearance.accent.preset,
        ),
        h: numberValue(accent.h, defaults.appearance.accent.h, 0, 360),
        s: numberValue(accent.s, defaults.appearance.accent.s, 0, 100),
        l: numberValue(accent.l, defaults.appearance.accent.l, 0, 100),
      },
      background: {
        flames: enumValue(
          background.flames,
          ["off", "subtle", "dynamic"] as const,
          defaults.appearance.background.flames,
        ),
        sparks: booleanValue(
          background.sparks,
          defaults.appearance.background.sparks,
        ),
        vignette: booleanValue(
          background.vignette,
          defaults.appearance.background.vignette,
        ),
      },
      glass: {
        blurPx: numberValue(
          glass.blurPx,
          defaults.appearance.glass.blurPx,
          0,
          40,
        ),
        alpha: numberValue(
          glass.alpha,
          defaults.appearance.glass.alpha,
          0,
          1,
        ),
      },
      cards: {
        radius: enumValue(
          cards.radius,
          [12, 16, 20, 24] as const,
          defaults.appearance.cards.radius,
        ),
        glow: enumValue(
          cards.glow,
          ["off", "soft", "strong"] as const,
          defaults.appearance.cards.glow,
        ),
      },
      density: enumValue(
        appearance.density,
        ["comfortable", "compact"] as const,
        defaults.appearance.density,
      ),
      type: {
        scale: enumValue(
          type.scale,
          [0.9, 1, 1.05, 1.1] as const,
          defaults.appearance.type.scale,
        ),
        family: enumValue(
          type.family,
          ["system", "inter", "jetbrains", "monaspace"] as const,
          defaults.appearance.type.family,
        ),
      },
      caret: {
        style: enumValue(
          caret.style,
          ["bar", "underline", "block"] as const,
          defaults.appearance.caret.style,
        ),
        blinkMs: numberValue(
          caret.blinkMs,
          defaults.appearance.caret.blinkMs,
          100,
          5000,
          true,
        ),
        color: enumValue(
          caret.color,
          ["accent", "white"] as const,
          defaults.appearance.caret.color,
        ),
        smoothCaret: enumValue(
          caret.smoothCaret,
          ["off", "fast", "medium", "slow"] as const,
          defaults.appearance.caret.smoothCaret,
        ),
      },
      motion: {
        reduce: booleanValue(motion.reduce, defaults.appearance.motion.reduce),
      },
      contrast: {
        high: booleanValue(contrast.high, defaults.appearance.contrast.high),
      },
      charts: {
        glow: enumValue(
          charts.glow,
          ["off", "ember"] as const,
          defaults.appearance.charts.glow,
        ),
      },
    },
    privacy: {
      publicProfile: booleanValue(
        privacy.publicProfile,
        defaults.privacy.publicProfile,
      ),
      shareRunsByDefault: booleanValue(
        privacy.shareRunsByDefault,
        defaults.privacy.shareRunsByDefault,
      ),
    },
  };
}

export function migratePreferences(
  raw: unknown,
  fromVersion?: number,
): PersistedPreferences {
  void fromVersion;
  return normalizePreferences(raw);
}

/**
 * Read the declared storage schema version of a raw record (accepting the same
 * `preferences`/`state`/bare envelopes as normalization). Returns null when no
 * finite numeric version is present.
 */
export function readSchemaVersion(raw: unknown): number | null {
  const source = sourceRecord(raw);
  const version = source.schemaVersion;
  return typeof version === "number" && Number.isFinite(version)
    ? version
    : null;
}

/**
 * True when a record declares a storage schema newer than this build can
 * represent. Such records must not be normalized-and-written-back (which would
 * silently downgrade them); callers keep the app usable locally and suspend
 * remote writes instead.
 */
export function isUnsupportedSchemaVersion(version: number | null): boolean {
  return typeof version === "number" && version > PREFERENCES_SCHEMA_VERSION;
}

export function toPreferences(state: SettingsData): PersistedPreferences {
  return normalizePreferences(state);
}

export function applyPreferences<T extends SettingsData>(
  state: T,
  preferences: unknown,
): T {
  const normalized = normalizePreferences(preferences);
  return {
    ...state,
    commands: normalized.commands,
    test: normalized.test,
    ai: normalized.ai,
    fx: normalized.fx,
    focus: normalized.focus,
    appearance: normalized.appearance,
    privacy: normalized.privacy,
  };
}

export function serializePreferences(preferences: unknown): string {
  return JSON.stringify(normalizePreferences(preferences));
}

export function deserializePreferences(serialized: string): PersistedPreferences {
  try {
    return normalizePreferences(JSON.parse(serialized));
  } catch {
    return normalizePreferences(null);
  }
}
