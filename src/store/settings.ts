"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { WordSetKey } from "@/lib/wordbanks";
import {
  APPLICATION_TEST_CONFIG,
  type WordTestCount,
} from "@/lib/prompt/testGenerationConfig";

export type CmdMode = "hidden" | "peek" | "full";
export type CmdDock = "br" | "bl" | "tr" | "tl";
export type TestMode = "words" | "time" | "quote" | "custom" | "coder";
export type AppearanceSettings = {
  theme?: "system"|"light"|"dark";
  accent: { preset: "blaze"|"ember"|"magma"|"plasma"|"aurora"|"custom"; h: number; s: number; l: number };
  background: { flames: "off"|"subtle"|"dynamic"; sparks: boolean; vignette: boolean };
  glass: { blurPx: number; alpha: number };
  cards: { radius: 12|16|20|24; glow: "off"|"soft"|"strong" };
  density: "comfortable"|"compact";
  type: { scale: 0.9|1|1.05|1.1; family: "system"|"inter"|"jetbrains"|"monaspace" };
  caret: { style: "bar"|"underline"|"block"; blinkMs: number; color: "accent"|"white"; smoothCaret: "off"|"fast"|"medium"|"slow" };
  motion: { reduce: boolean };
  contrast: { high: boolean };
  charts: { glow: "off"|"ember" };
};

export interface SettingsState {
  commands: {
    defaultMode: CmdMode;          // "peek"
    defaultDock: CmdDock;          // "br"
    autoShowOnResults: boolean;    // true
    autoPeekDelayMs: number;       // 8000
  };
  test: {
    defaultMode: TestMode;         // "words"
    defaultLength: WordTestCount;  // 10|15|20|30|50
    wordSet: WordSetKey;           // "core5000"
    include_numbers: boolean;      // false
    include_punctuation: boolean;  // false
    maxRepeatPerWord?: number;     // 2 (optional; default in code paths)
    stopOnError: boolean;          // false: allow advance with mistakes
    strictSpace: boolean;          // false: Monkeytype-like spacing
    blazeModeEnabled: boolean;
  };
  ai: {
    coachEnabled: boolean;
    includeDigraphs: boolean;
    intensity: "low"|"med"|"high";
  };
  fx: {
    fxEnabled: boolean;            // true
    fxIntensity: "low" | "med" | "high"; // "med"
  };
  focus: {
    enabled: boolean;
    exitOnMouseMove: boolean;
    blurWarning: boolean;
  };
  appearance: AppearanceSettings;
  setTheme: (value: "system"|"light"|"dark") => void;
  privacy: {
    publicProfile: boolean;        // false (placeholder)
    shareRunsByDefault: boolean;   // false (placeholder)
  };
  update<K extends keyof SettingsState>(k: K, v: Partial<SettingsState[K]>): void;
  updateAppearance(patch: Partial<AppearanceSettings>): void;
  setAccentPreset(preset: AppearanceSettings["accent"]["preset"]): void;
  reset(): void;
  export(): string;                // JSON
  import(json: string): void;      // merge-with-validate
}

const DEFAULTS: SettingsState = {
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
    caret: { style: "bar", blinkMs: 750, color: "accent", smoothCaret: "medium" },
    motion: { reduce: false },
    contrast: { high: false },
    charts: { glow: "ember" },
  },
  privacy: {
    publicProfile: false,
    shareRunsByDefault: false,
  },
  update: () => {},
  updateAppearance: () => {},
  setTheme: () => {},
  setAccentPreset: () => {},
  reset: () => {},
  export: () => "{}",
  import: () => {},
};

function isCmdMode(x: any): x is CmdMode { return x === "hidden" || x === "peek" || x === "full"; }
function isDock(x: any): x is CmdDock { return x === "br" || x === "bl" || x === "tr" || x === "tl"; }
function isTestMode(x: any): x is TestMode { return x === "words" || x === "time" || x === "quote" || x === "custom" || x === "coder"; }

export const useSettingsStore = create<SettingsState>()(persist((set, get) => ({
  ...DEFAULTS,
  update: (k, v) => set(s => ({ ...s, [k]: { ...s[k], ...v } } as SettingsState)),
  updateAppearance: (patch) => set(s => ({ ...s, appearance: { ...s.appearance, ...patch } } as SettingsState)),
  setTheme: (value) => set(s => ({ ...s, appearance: { ...s.appearance, theme: value } } as SettingsState)),
  setAccentPreset: (preset) => set(s => {
    const presets: Record<string,{h:number;s:number;l:number}> = {
      blaze:{h:24,s:95,l:55}, ember:{h:32,s:90,l:56}, magma:{h:8,s:92,l:55}, plasma:{h:264,s:90,l:62}, aurora:{h:168,s:80,l:52}
    };
    const cur = { ...s.appearance };
    cur.accent.preset = preset as any;
    if (preset !== "custom" && presets[preset]) {
      const p = presets[preset]; cur.accent.h = p.h; cur.accent.s = p.s; cur.accent.l = p.l;
    }
    return { ...s, appearance: cur } as SettingsState;
  }),
  reset: () => set(() => ({ ...DEFAULTS })),
  export: () => {
    try { return JSON.stringify(get()); } catch { return "{}"; }
  },
  import: (json: string) => {
    try {
      const obj = JSON.parse(json) as Partial<SettingsState>;
      if (obj.commands) {
        const c = obj.commands as any;
        const next = { ...get().commands };
        if (isCmdMode(c.defaultMode)) next.defaultMode = c.defaultMode;
        if (isDock(c.defaultDock)) next.defaultDock = c.defaultDock;
        if (typeof c.autoShowOnResults === "boolean") next.autoShowOnResults = c.autoShowOnResults;
        if (typeof c.autoPeekDelayMs === "number" && c.autoPeekDelayMs >= 2000 && c.autoPeekDelayMs <= 20000) next.autoPeekDelayMs = c.autoPeekDelayMs;
        set(s => ({ ...s, commands: next }));
      }
      if (obj.test) {
        const t = obj.test as any;
        const next = { ...get().test };
        if (isTestMode(t.defaultMode)) next.defaultMode = t.defaultMode;
        if ([10,15,20,30,50].includes(Number(t.defaultLength))) {
          next.defaultLength = Number(t.defaultLength) as WordTestCount;
        }
        if (["core200", "core1000", "core5000"].includes(t.wordSet)) next.wordSet = t.wordSet;
        if (typeof t.include_numbers === "boolean") next.include_numbers = t.include_numbers;
        if (typeof t.include_punctuation === "boolean") next.include_punctuation = t.include_punctuation;
        if (typeof t.maxRepeatPerWord === "number" && t.maxRepeatPerWord >= 1 && t.maxRepeatPerWord <= 5) next.maxRepeatPerWord = Math.floor(t.maxRepeatPerWord);
        if (typeof t.stopOnError === "boolean") next.stopOnError = t.stopOnError;
        if (typeof t.strictSpace === "boolean") next.strictSpace = t.strictSpace;
        set(s => ({ ...s, test: next }));
      }
      if (obj.privacy) {
        const p = obj.privacy as any;
        const next = { ...get().privacy };
        if (typeof p.publicProfile === "boolean") next.publicProfile = p.publicProfile;
        if (typeof p.shareRunsByDefault === "boolean") next.shareRunsByDefault = p.shareRunsByDefault;
        set(s => ({ ...s, privacy: next }));
      }
      if ((obj as any).focus) {
        const f = (obj as any).focus as Partial<SettingsState["focus"]>;
        const next = { ...get().focus };
        if (typeof f.enabled === "boolean") next.enabled = f.enabled;
        if (typeof f.exitOnMouseMove === "boolean") next.exitOnMouseMove = f.exitOnMouseMove;
        if (typeof f.blurWarning === "boolean") next.blurWarning = f.blurWarning;
        set(s => ({ ...s, focus: next }));
      }
      if ((obj as any).appearance) {
        const a = (obj as any).appearance as Partial<AppearanceSettings>;
        set(s => ({ ...s, appearance: { ...s.appearance, ...a } }));
      }
    } catch {}
  },
}), { name: "bk:settings:v1", version: 1, migrate: (state: any) => ({ ...DEFAULTS, ...(state||{}) }) }));

// Selectors (future proof)
export const useStopOnError = () => useSettingsStore(s => s.test.stopOnError);
export const useStrictSpace = () => useSettingsStore(s => s.test.strictSpace);
export const useFxEnabled = () => useSettingsStore(s => s.fx.fxEnabled);
export const useFxIntensity = () => useSettingsStore(s => s.fx.fxIntensity);


