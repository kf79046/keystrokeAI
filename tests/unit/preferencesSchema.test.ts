import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PREFERENCES_SCHEMA_VERSION,
  applyPreferences,
  applicationSettingsDefaults,
  deserializePreferences,
  isUnsupportedSchemaVersion,
  migratePreferences,
  normalizePreferences,
  readSchemaVersion,
  serializePreferences,
  toPreferences,
} from "../../src/lib/settings/preferencesSchema";

describe("preference schema", () => {
  it("uses the canonical application defaults", () => {
    const preferences = normalizePreferences(null);
    const defaults = applicationSettingsDefaults();

    assert.equal(preferences.schemaVersion, PREFERENCES_SCHEMA_VERSION);
    assert.deepEqual(
      { ...preferences, schemaVersion: undefined },
      { ...defaults, schemaVersion: undefined },
    );
    assert.equal(preferences.test.defaultLength, 15);
    assert.equal(preferences.test.include_numbers, false);
    assert.equal(preferences.test.include_punctuation, false);
  });

  it("accepts a complete valid record", () => {
    const complete = normalizePreferences({
      schemaVersion: 1,
      commands: {
        defaultMode: "full",
        defaultDock: "tl",
        autoShowOnResults: false,
        autoPeekDelayMs: 2000,
      },
      test: {
        defaultMode: "time",
        defaultLength: 50,
        wordSet: "core200",
        include_numbers: true,
        include_punctuation: true,
        maxRepeatPerWord: 5,
        stopOnError: true,
        strictSpace: true,
        blazeModeEnabled: true,
      },
      ai: { coachEnabled: false, includeDigraphs: false, intensity: "high" },
      fx: { fxEnabled: false, fxIntensity: "low" },
      focus: { enabled: false, exitOnMouseMove: true, blurWarning: false },
      appearance: {
        theme: "dark",
        accent: { preset: "custom", h: 300, s: 80, l: 60 },
        background: { flames: "dynamic", sparks: false, vignette: false },
        glass: { blurPx: 20, alpha: 0.5 },
        cards: { radius: 24, glow: "strong" },
        density: "compact",
        type: { scale: 1.1, family: "monaspace" },
        caret: {
          style: "block",
          blinkMs: 1000,
          color: "white",
          smoothCaret: "slow",
        },
        motion: { reduce: true },
        contrast: { high: true },
        charts: { glow: "off" },
      },
      privacy: { publicProfile: true, shareRunsByDefault: true },
    });

    assert.equal(complete.commands.defaultMode, "full");
    assert.equal(complete.test.wordSet, "core200");
    assert.equal(complete.appearance.accent.preset, "custom");
    assert.equal(complete.privacy.publicProfile, true);
  });

  it("normalizes partial, malformed, nested, and unknown fields safely", () => {
    const defaults = normalizePreferences(null);
    const normalized = normalizePreferences({
      schemaVersion: 999,
      futureGroup: { enabled: true },
      commands: { defaultMode: "future", autoPeekDelayMs: 10 },
      test: {
        include_numbers: true,
        include_punctuation: "yes",
        defaultLength: 999,
        maxRepeatPerWord: 7,
        futureSetting: true,
      },
      appearance: {
        accent: "broken",
        glass: { blurPx: Number.POSITIVE_INFINITY, alpha: -1 },
        caret: { style: "beam" },
      },
    });

    assert.equal(normalized.schemaVersion, 1);
    assert.equal(normalized.commands.defaultMode, defaults.commands.defaultMode);
    assert.equal(normalized.commands.autoPeekDelayMs, defaults.commands.autoPeekDelayMs);
    assert.equal(normalized.test.include_numbers, true);
    assert.equal(
      normalized.test.include_punctuation,
      defaults.test.include_punctuation,
    );
    assert.equal(normalized.test.defaultLength, defaults.test.defaultLength);
    assert.deepEqual(normalized.appearance.accent, defaults.appearance.accent);
    assert.equal("futureGroup" in normalized, false);
    assert.equal("futureSetting" in normalized.test, false);
  });

  it("migrates legacy local envelopes and camel-case test flags", () => {
    const migrated = migratePreferences({
      state: {
        test: {
          defaultLength: 30,
          includeNumbers: true,
          includePunctuation: true,
          max_repeat_per_word: 4,
        },
      },
      version: 1,
    }, 1);

    assert.equal(migrated.test.defaultLength, 30);
    assert.equal(migrated.test.include_numbers, true);
    assert.equal(migrated.test.include_punctuation, true);
    assert.equal(migrated.test.maxRepeatPerWord, 4);
    assert.deepEqual(migrated.commands, normalizePreferences(null).commands);
  });

  it("round-trips deterministically and drops action members", () => {
    const state = {
      ...normalizePreferences({ test: { include_numbers: true } }),
      update: () => {},
      reset: () => {},
    };
    const preferences = toPreferences(state);
    const first = serializePreferences(preferences);
    const second = serializePreferences(deserializePreferences(first));

    assert.equal(first, second);
    assert.equal("update" in preferences, false);
    assert.equal("reset" in preferences, false);
  });

  it("applies data without clobbering action members", () => {
    const update = () => "kept";
    const state = { ...normalizePreferences(null), update };
    const applied = applyPreferences(state, {
      test: { include_punctuation: true },
    });

    assert.equal(applied.update, update);
    assert.equal(applied.test.include_punctuation, true);
    assert.equal(applied.test.include_numbers, false);
  });

  it("deserializes malformed JSON to defaults without throwing", () => {
    assert.deepEqual(
      deserializePreferences("{not-json"),
      normalizePreferences(null),
    );
  });

  it("detects unsupported future schema versions without downgrading in place", () => {
    assert.equal(readSchemaVersion({ schemaVersion: 2 }), 2);
    assert.equal(readSchemaVersion({ preferences: { schemaVersion: 3 } }), 3);
    assert.equal(readSchemaVersion({ state: { schemaVersion: 5 } }), 5);
    assert.equal(readSchemaVersion({}), null);
    assert.equal(readSchemaVersion({ schemaVersion: "2" }), null);

    assert.equal(isUnsupportedSchemaVersion(PREFERENCES_SCHEMA_VERSION + 1), true);
    assert.equal(isUnsupportedSchemaVersion(PREFERENCES_SCHEMA_VERSION), false);
    assert.equal(isUnsupportedSchemaVersion(0), false);
    assert.equal(isUnsupportedSchemaVersion(null), false);
  });
});
