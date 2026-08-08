"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  APPLICATION_SETTINGS_DEFAULTS,
  PREFERENCES_SCHEMA_VERSION,
  applyPreferences as applyPreferencesToState,
  applicationSettingsDefaults,
  migratePreferences,
  normalizePreferences,
  serializePreferences,
  toPreferences,
  type AppearanceSettings,
  type CmdDock,
  type CmdMode,
  type PersistedPreferences,
  type SettingsData,
  type SettingsTestMode,
} from "@/lib/settings/preferencesSchema";

export type { AppearanceSettings, CmdDock, CmdMode };
export type TestMode = SettingsTestMode;

export type SettingsState = PersistedPreferences & {
  setTheme: (value: "system" | "light" | "dark") => void;
  update<K extends keyof SettingsData>(
    key: K,
    value: Partial<SettingsData[K]>,
  ): void;
  updateAppearance(patch: Partial<AppearanceSettings>): void;
  setAccentPreset(preset: AppearanceSettings["accent"]["preset"]): void;
  applyPreferences(preferences: unknown): void;
  reset(): void;
  export(): string;
  import(json: string): void;
};

/** Backward-compatible name; all consumers share the schema module's defaults. */
export const DEFAULTS = APPLICATION_SETTINGS_DEFAULTS;

function dataWithVersion(): PersistedPreferences {
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    ...applicationSettingsDefaults(),
  };
}

function mergeAppearance(
  current: AppearanceSettings,
  patch: Partial<AppearanceSettings>,
): AppearanceSettings {
  return {
    ...current,
    ...patch,
    accent: { ...current.accent, ...(patch.accent ?? {}) },
    background: { ...current.background, ...(patch.background ?? {}) },
    glass: { ...current.glass, ...(patch.glass ?? {}) },
    cards: { ...current.cards, ...(patch.cards ?? {}) },
    type: { ...current.type, ...(patch.type ?? {}) },
    caret: { ...current.caret, ...(patch.caret ?? {}) },
    motion: { ...current.motion, ...(patch.motion ?? {}) },
    contrast: { ...current.contrast, ...(patch.contrast ?? {}) },
    charts: { ...current.charts, ...(patch.charts ?? {}) },
  };
}

const ACCENT_PRESETS: Record<string, { h: number; s: number; l: number }> = {
  blaze: { h: 24, s: 95, l: 55 },
  ember: { h: 32, s: 90, l: 56 },
  magma: { h: 8, s: 92, l: 55 },
  plasma: { h: 264, s: 90, l: 62 },
  aurora: { h: 168, s: 80, l: 52 },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...dataWithVersion(),
      update: (key, value) => set((state) => {
        const next = {
          ...toPreferences(state),
          [key]: { ...state[key], ...value },
        };
        return applyPreferencesToState(state, next);
      }),
      updateAppearance: (patch) => set((state) => applyPreferencesToState(
        state,
        {
          ...toPreferences(state),
          appearance: mergeAppearance(state.appearance, patch),
        },
      )),
      setTheme: (value) => set((state) => applyPreferencesToState(
        state,
        {
          ...toPreferences(state),
          appearance: mergeAppearance(state.appearance, { theme: value }),
        },
      )),
      setAccentPreset: (preset) => set((state) => {
        const presetColor = preset === "custom" ? null : ACCENT_PRESETS[preset];
        return applyPreferencesToState(state, {
          ...toPreferences(state),
          appearance: mergeAppearance(state.appearance, {
            accent: {
              ...state.appearance.accent,
              ...(presetColor ?? {}),
              preset,
            },
          }),
        });
      }),
      applyPreferences: (preferences) => set((state) => (
        applyPreferencesToState(state, preferences)
      )),
      reset: () => set((state) => applyPreferencesToState(
        state,
        dataWithVersion(),
      )),
      export: () => serializePreferences(toPreferences(get())),
      import: (json) => {
        try {
          const parsed = JSON.parse(json);
          set((state) => applyPreferencesToState(
            state,
            normalizePreferences(parsed),
          ));
        } catch {
          // A malformed import must never damage the current local settings.
        }
      },
    }),
    {
      name: "bk:settings:v1",
      version: 2,
      partialize: (state) => toPreferences(state),
      migrate: (persisted, version) => migratePreferences(persisted, version),
      merge: (persisted, current) => applyPreferencesToState(current, persisted),
    },
  ),
);

export const useStopOnError = () => useSettingsStore((state) => state.test.stopOnError);
export const useStrictSpace = () => useSettingsStore((state) => state.test.strictSpace);
export const useFxEnabled = () => useSettingsStore((state) => state.fx.fxEnabled);
export const useFxIntensity = () => useSettingsStore((state) => state.fx.fxIntensity);
