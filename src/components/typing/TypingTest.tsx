"use client"

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStatsStore } from '@/stores/useStatsStore';
import { useTotalsStore } from '@/stores/useTotalsStore';
import TypingBox from './TypingBox';
import ResultsPanel from './ResultsPanel';
import { 
  Clock, 
  Hash,
  AtSign,
  Triangle,
  Wrench,
  Globe,
  Zap,
  Target,
  Timer
} from 'lucide-react';
import clsx from 'clsx';
import { fetchJSON } from '@/lib/http';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import { getWordset } from "@/lib/wordbanks";
import { mulberry32 } from "@/lib/prng";
import { StringLRU } from "@/lib/lru";
import { buildAdaptiveBatch } from "@/lib/generator/adaptive";
import { sanitizePrompt } from "@/lib/prompt/sanitize";
import BlazeOverlay from "./BlazeOverlay";
import BlazeInterlude from "./BlazeInterlude";
import { Switch } from "@/components/ui/switch";
import * as Tooltip from "@/components/ui/tooltip";
import { buildCoderPrompt, type CoderLanguage } from "@/lib/coder-snippets";
import { CoderLanguageChips } from "./CoderLanguageChips";
import { enforceNoRepeat } from "@/lib/prompt/noRepeatLimiter";
import ReadyToast from '@/components/typing/ReadyToast';
import LogoLoader from '@/components/common/LogoLoader';
import LatencyHUD from "@/components/dev/LatencyHUD";
import PreTestOverlay from '@/components/typing/PreTestOverlay';
import ClickOnly from '@/components/common/ClickOnly';
import { BK_EVENTS } from "@/lib/events";
import { useLastTestStore, readLastTestSafe } from "@/stores/useLastTestStore";
import { tl } from '@/lib/timeline';
import { devLog } from '@/lib/devLog';
import useLockScroll from "@/hooks/useLockScroll";
import { postOrEnqueue } from "@/lib/http";
import OutOfFocusNotice from "@/components/typing/OutOfFocusNotice";
import { useUIStore } from "@/stores/useUIStore";
import { useSettingsStore } from "@/store/settings";
import { weakspot } from "@/ai/weakspot";
import { useAICoach } from "@/store/aiCoach";
import { useHydrated } from "@/lib/useHydrated";
import { flushSync } from 'react-dom';
import { upsertLatestWpmSample, withOfficialFinalSample } from '@/lib/resultsSeries';
import { finalizeGeneratedPrompt } from "@/lib/prompt/finalizeGeneratedPrompt";
import {
  generateTimeFallback,
  generateWordFallback,
} from "@/lib/prompt/localFallback";
import {
  isFinalizedSoloPrompt,
  specialRunConfig,
  type FinalizedSoloPrompt,
  type SpecialRunConfig,
  type TypingPrompt,
} from "@/lib/prompt/preparedPrompt";
import {
  APPLICATION_TEST_CONFIG,
  normalizeTestGenerationConfig,
  resolveInitialTestConfig,
  type TestGenerationConfig,
  type TestGenerationConfigInput,
} from "@/lib/prompt/testGenerationConfig";
import {
  isSettingsHydrationSettled,
  useSettingsSyncStore,
} from "@/hooks/useSettingsSync";

// --- NEW: simple local history for adaptive difficulty ---
const HISTORY_KEY = "ks_history_v1";
type Hist = { wpm: number; acc: number; ts: number };
function readHist(): Hist[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as Hist[]; } catch { return []; }
}
function writeHist(items: Hist[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-5))); } catch {}
}
function movingAvg(items: Hist[]) {
  if (!items.length) return { wpm: 0, acc: 100 };
  const n = items.length;
  const wpm = Math.round(items.reduce((s, x) => s + x.wpm, 0) / n);
  const acc = Math.round(items.reduce((s, x) => s + x.acc, 0) / n);
  return { wpm, acc };
}

function afterNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || document.visibilityState === "hidden") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Hard upper bound on how long first-test boot waits for the full auth + settings
 * resolution chain to settle. If auth (`/api/auth/me`) or the settings sync stalls
 * past this, boot proceeds from safe locally-hydrated/default settings so the
 * typing prompt never hangs. Late remote preferences still land in the store and
 * apply to the NEXT test only — they cannot mutate the already-active prompt
 * (guarded by `bootConfigured`).
 */
export const BOOT_SETTINGS_FALLBACK_MS = 4000;

const TypingTest: React.FC = () => {
  
  type PromptLoad = 'idle'|'loading'|'ready'|'error';
  const [promptLoad, setPromptLoad] = useState<PromptLoad>('idle');
  const [blazeTransition, setBlazeTransition] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [blazeUi, setBlazeUi] = React.useState<'off'|'toggle'|'post'>('off');

  // Hydration and Blaze state
  const isHydrated = useHydrated();
  const blazeEnabled = useSettingsStore(s => s.test.blazeModeEnabled);

  // Hold times
  const BLAZE_TOGGLE_MIN_MS = 3000; // 3s pre-test
  const BLAZE_POST_MIN_MS = 3500;   // 3.5s pre-results
  const bootLockRef = useRef(false);
  const bootAbortRef = useRef<AbortController | null>(null);
  const [wpm, setWpm] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [time, setTime] = useState(0);
  const [isTestComplete, setIsTestComplete] = useState(false);
  const [view, setView] = useState<'typing' | 'results'>('typing');
  const [wpmSeries, setWpmSeries] = useState<Array<{ second: number; wpm: number }>>([]);
  const [analysisResult, setAnalysisResult] = useState<null | {
    input: string;
    corrections: string[];
    difficulty: string;
    feedback: string;
  }>(null);
  const [offsetPx, setOffsetPx] = React.useState(0);

  // Test configuration state
  const [testMode, setTestMode] = useState<'time' | 'words' | 'coder' | 'zen' | 'custom'>('words');
  // functional mode + duration (time mode)
  const [mode, setMode] = useState<'words' | 'time'>('words');
  const [durationSec, setDurationSec] = useState<number>(15);
  const [wordCount, setWordCount] = useState<number>(15);
  const [showPunctuation, setShowPunctuation] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const DEFAULT_WORDS = APPLICATION_TEST_CONFIG.wordCount ?? 15;

  const DEFAULT_TIME_SEC = 15; // keep current behavior

  // Track first entry into a mode within this component lifecycle
  const enteredRef = React.useRef<{ time: boolean; words: boolean; coder: boolean }>({
    time: false,
    words: false,
    coder: false,
  });
  const [coderLang, setCoderLang] = React.useState<CoderLanguage>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem("bk:coder:lang") : null;
      if (saved === "javascript" || saved === "python" || saved === "html" || saved === "css" || saved === "java") return saved as CoderLanguage;
    } catch {}
    return "javascript";
  });
  useEffect(() => { try { window.localStorage.setItem("bk:coder:lang", coderLang); } catch {} }, [coderLang]);
  
  // Gate to ensure we apply last-used config before first prompt loads
  const [bootConfigured, setBootConfigured] = useState(false);
  const settingsSyncStatus = useSettingsSyncStore((state) => state.status);
  const settingsHydrationSettled = isSettingsHydrationSettled(settingsSyncStatus);
  // Bounded total fallback: if auth/settings resolution stalls, boot anyway from
  // safe local/default settings so the prompt is never blocked indefinitely.
  const [bootFallbackReady, setBootFallbackReady] = useState(false);
  useEffect(() => {
    if (settingsHydrationSettled || bootConfigured) return;
    const timer = setTimeout(
      () => setBootFallbackReady(true),
      BOOT_SETTINGS_FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [settingsHydrationSettled, bootConfigured]);
  const bootReady = settingsHydrationSettled || bootFallbackReady;

  // Reentrancy/coordination for new-test triggers
  const newReqTokenRef = useRef(0);
  const applyingRef = useRef(false);
  // Serialize prompt loads and drop stale results
  const loadTokenRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const prefetchedRef = useRef<{ token: number; prompt: FinalizedSoloPrompt } | null>(null);
  const initializedConfigRef = useRef<TestGenerationConfig>({
    ...APPLICATION_TEST_CONFIG,
  });
  const activePromptRef = useRef<FinalizedSoloPrompt | null>(null);
  const specialRunConfigRef = useRef<SpecialRunConfig | null>(null);
  const appendSequenceRef = useRef(0);

  // Backend prompt state
  const [currentPrompt, setCurrentPrompt] = useState<TypingPrompt>("");
  const sessionUsedSeeds = useRef<Set<number>>(new Set());
  // backend base URL routed via fetchJSON
  // results-view combo restart listener (moved below to avoid forward reference)

  const [avgWpm, setAvgWpm] = useState<number>(0);
  const [avgAcc, setAvgAcc] = useState<number>(100);

  useEffect(() => {
    try { tl('TypingTest mount'); } catch {}
    try { devLog('TypingTest mount'); } catch {}
    return () => { try { tl('TypingTest unmount'); } catch {} ; try { devLog('TypingTest unmount'); } catch {} };
  }, []);

  // Mark results-active on <body> so global hotkeys can back off
  useEffect(() => {
    const on = view === 'results';
    try { document.body.classList.toggle('bk-results-active', on); } catch {}
    return () => { try { document.body.classList.remove('bk-results-active'); } catch {} };
  }, [view]);

  // Ensure focus mode is cleared when entering results
  useEffect(() => {
    if (view === 'results') {
      try { useUIStore.getState().setFocus(false); } catch {}
    }
  }, [view]);

  // Reset page scroll to top whenever we enter the typing view.
  // Why: the results page is the full document scroll; if the user scrolled down
  // to view AI feedback and then pressed Tab+Enter, the page is still scrolled
  // when TypingBox mounts. The fixed filter bar sits at viewport-top, but the
  // typing column is position:relative inside the document, so a non-zero
  // scrollY made the test text render too high — visually overlapping the
  // filter bar. useLayoutEffect runs synchronously after DOM commit (before
  // paint) and before TypingBox's useLockScroll engages, so the lock then
  // freezes the page at scrollY=0 — guaranteeing identical positioning across
  // every path that enters typing (initial load, Tab+Enter pre-test,
  // Tab+Enter from results, mode/length button clicks, AI Coach drills).
  useLayoutEffect(() => {
    if (view !== 'typing') return;
    try { window.scrollTo(0, 0); } catch {}
    try { document.documentElement.scrollTop = 0; } catch {}
    try { document.body.scrollTop = 0; } catch {}
  }, [view]);

  // Refs used for measurement and layout offsets
  const filterRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const statsRef  = useRef<HTMLDivElement | null>(null);

  // overlay is visible before the test actually starts
  const overlayVisible =
    view !== 'results' && !(view === 'typing' && !isTestComplete && time > 0);

  const isRunning = view === 'typing' && !isTestComplete && time > 0;

  // Track last known filter height to preserve across visibility changes
  const lastFilterHRef = React.useRef<number>(140); // default fallback
  
  // Consolidated measurement and CSS var writer
  const recalcOffsets = React.useCallback(() => {
    const root = rootRef.current;
    
    const headerEl =
      (document.querySelector('[data-app-header]') as HTMLElement) ||
      (document.querySelector('header') as HTMLElement) ||
      null;
    
    const headerH = headerEl?.getBoundingClientRect().height ?? 64;
    const rawFilterH = filterRef.current?.getBoundingClientRect().height ?? 0;
    const statsH  = statsRef.current?.getBoundingClientRect().height ?? 0;
    
    // Preserve last known filter height when filter is hidden (rawFilterH = 0)
    // This ensures --bk-filter-h is never 0 and typing text position stays stable
    const filterH = rawFilterH > 0 ? rawFilterH : lastFilterHRef.current;
    if (rawFilterH > 0) {
      lastFilterHRef.current = rawFilterH;
    }
    
    // Write globals for other components (header, filter, stats)
    const writeVars = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty('--bk-header-h', `${Math.round(headerH)}px`);
      el.style.setProperty('--bk-filter-h', `${Math.round(filterH)}px`);
      el.style.setProperty('--bk-stats-h', `${Math.round(statsH)}px`);
    };
    writeVars(document.documentElement);
    writeVars(root ?? null);
    
    // *** Use state for spacer instead of CSS variable ***
    setOffsetPx(overlayVisible ? Math.round(filterH) : 0);
  }, [overlayVisible]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(recalcOffsets);

    const observers: ResizeObserver[] = [];

    const headerEl =
      (document.querySelector('[data-app-header]') as HTMLElement) ||
      (document.querySelector('header') as HTMLElement) ||
      null;
    if (headerEl) {
      const ro = new ResizeObserver(recalcOffsets);
      ro.observe(headerEl);
      observers.push(ro);
    }
    if (filterRef.current) {
      const ro = new ResizeObserver(recalcOffsets);
      ro.observe(filterRef.current);
      observers.push(ro);
    }
    if (statsRef.current) {
      const ro = new ResizeObserver(recalcOffsets);
      ro.observe(statsRef.current);
      observers.push(ro);
    }

    try { window.addEventListener('resize', recalcOffsets, { passive: true } as AddEventListenerOptions); } catch { window.addEventListener('resize', recalcOffsets); }

    return () => {
      try { cancelAnimationFrame(raf); } catch {}
      for (const ro of observers) { try { ro.disconnect(); } catch {} }
      window.removeEventListener('resize', recalcOffsets);
    };
  }, [recalcOffsets, view, overlayVisible, isTestComplete, time, promptLoad, showPunctuation, showNumbers, testMode, durationSec]);

  // Reflect zen mode to the document for global backdrop behavior
  useEffect(() => {
    try {
      document.documentElement.dataset.zen = testMode === 'zen' ? '1' : '0';
      // notify any listeners that zen mode changed
      window.dispatchEvent(new Event('bk:zenChanged'));
    } catch {}
  }, [testMode]);

  // Apply last-used config before first load
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (bootConfigured || !bootReady) return;
    const settings = useSettingsStore.getState().test;
    const persistedDefaults: TestGenerationConfigInput = {
      mode:
        settings.defaultMode === "time" || settings.defaultMode === "words"
          ? settings.defaultMode
          : APPLICATION_TEST_CONFIG.mode,
      wordCount: settings.defaultLength,
      durationSeconds: DEFAULT_TIME_SEC,
      includeNumbers: settings.include_numbers,
      includePunctuation: settings.include_punctuation,
      wordSet: settings.wordSet,
      maxRepeatPerWord:
        settings.maxRepeatPerWord ?? APPLICATION_TEST_CONFIG.maxRepeatPerWord,
    };
    const saved = (() => {
      try {
        return useLastTestStore.getState().last?.config ?? readLastTestSafe();
      } catch {
        return null;
      }
    })();
    const resolved = resolveInitialTestConfig({
      persistedDefaults,
      lastUsed: saved,
    });
    initializedConfigRef.current = { ...resolved };
    try { devLog('applyResolvedTestConfig', resolved); } catch {}
    setMode(resolved.mode);
    setTestMode(resolved.mode);
    if (resolved.mode === "time") {
      setDurationSec(resolved.durationSeconds ?? DEFAULT_TIME_SEC);
    } else {
      setWordCount(resolved.wordCount ?? DEFAULT_WORDS);
    }
    setShowNumbers(resolved.includeNumbers);
    setShowPunctuation(resolved.includePunctuation);
    setBootConfigured(true);
  }, [DEFAULT_WORDS, bootConfigured, bootReady]);

  type GeneratePayload = {
    mode: 'words' | 'time';
    count?: number;
    duration?: number;
    include_punctuation?: boolean;
    include_numbers?: boolean;
    language?: string;
    difficulty?: 'easy'|'medium'|'hard'|'auto';
    recent_wpm?: number;
    recent_accuracy?: number;
    seed?: number;
  };

  const createRequestedConfig = useCallback((
    override: TestGenerationConfigInput = {},
  ): TestGenerationConfig => {
    const selectedMode = override.mode ?? mode;
    const candidate: TestGenerationConfigInput = {
      ...initializedConfigRef.current,
      mode: selectedMode,
      wordCount:
        selectedMode === "words"
          ? override.wordCount ?? wordCount
          : undefined,
      durationSeconds:
        selectedMode === "time"
          ? override.durationSeconds ?? durationSec
          : undefined,
      includePunctuation:
        override.includePunctuation ?? showPunctuation,
      includeNumbers: override.includeNumbers ?? showNumbers,
      ...override,
    };
    return normalizeTestGenerationConfig(
      candidate,
      initializedConfigRef.current,
    );
  }, [durationSec, mode, showNumbers, showPunctuation, wordCount]);

  const loadPromptOnce = useCallback(async (opts?: {
    useFallback?: boolean;
    config?: TestGenerationConfig;
    __prefetch?: boolean;
  }) => {
    if (bootLockRef.current) return;
    const myToken = ++loadTokenRef.current;
    bootLockRef.current = true;
    setPromptError(null);
    setPromptLoad('loading');
    try { devLog('prompt:begin', { token: myToken, opts }); } catch {}

    try { bootAbortRef.current?.abort(); } catch {}
    try { activeControllerRef.current?.abort(); } catch {}
    const ac = new AbortController();
    bootAbortRef.current = ac;
    activeControllerRef.current = ac;

    try {
      const isCoder = testMode === 'coder';
      if (isCoder) {
        const coderPrompt = buildCoderPrompt(coderLang, 25)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 25)
          .join(" ");
        activePromptRef.current = null;
        specialRunConfigRef.current = specialRunConfig({
          text: coderPrompt,
          mode: "words",
          wordCount: 25,
          durationSec: null,
          language: coderLang,
        });
        appendSequenceRef.current = 0;
        React.startTransition(() => {
          setIsTestComplete(false);
          setTime(0);
          setView("typing");
          setCurrentPrompt(coderPrompt);
          setPromptLoad("ready");
        });
        bootLockRef.current = false;
        return;
      }

      const config = opts?.config ?? createRequestedConfig();
      const wordPool = getWordset(config.wordSet);
      let finalized = null as ReturnType<typeof finalizeGeneratedPrompt> | null;
      let resolvedDifficulty: FinalizedSoloPrompt["resolvedDifficulty"];

      if (!opts?.useFallback) {
        const hist = readHist();
        const avg = movingAvg(hist);
        const payload: GeneratePayload = {
          mode: config.mode,
          count: config.mode === "words" ? config.wordCount : undefined,
          duration:
            config.mode === "time" ? config.durationSeconds : undefined,
          include_punctuation: config.includePunctuation,
          include_numbers: config.includeNumbers,
          language: 'english',
          difficulty: config.difficulty,
          recent_wpm: avg.wpm,
          recent_accuracy: avg.acc,
          seed: config.seed,
        };
        try { tl('prompt->request', { reqId: Date.now(), cfg: payload }); } catch {}
        try { devLog('prompt:request', payload); } catch {}

        const data = await fetchWithRetry('/api/generate-proxy', {
          attempts: 3,
          timeoutMs: 10000,
          backoffMs: 700,
          factor: 1.7,
          fetchInit: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: bootAbortRef.current?.signal as unknown as AbortSignal,
          },
        });
        const promptText = data?.text ?? data?.prompt ?? data?.data?.prompt;
        if (!String(promptText ?? "").trim()) {
          throw new Error("Generation response did not include prompt text");
        }
        if (
          !data?.flags ||
          data.flags.punctuation !== config.includePunctuation ||
          data.flags.numbers !== config.includeNumbers
        ) {
          throw new Error("Generation response flags do not match the requested config");
        }
        if (
          data?.difficulty !== "easy" &&
          data?.difficulty !== "medium" &&
          data?.difficulty !== "hard"
        ) {
          throw new Error("Generation response did not include a resolved difficulty");
        }
        resolvedDifficulty = data.difficulty;
        const responseSeed = Number(data.seed);
        if (!Number.isSafeInteger(responseSeed)) {
          throw new Error("Generation response did not include a valid seed");
        }
        sessionUsedSeeds.current.add(responseSeed);
        finalized = finalizeGeneratedPrompt({
          rawText: String(promptText),
          config,
          expectedTokenCount: config.mode === "words" ? config.wordCount! : 200,
          seed: responseSeed,
          wordPool,
        });
        try { tl('prompt->received', { reqId: 'auto', promptId: data?.seed ?? 'n/a' }); } catch {}
        try { devLog('prompt:received', { seed: data?.seed }); } catch {}
      } else {
        let recentWords: string[] = [];
        try {
          recentWords = JSON.parse(localStorage.getItem("bk-recent-words") || "[]");
        } catch {}
        finalized = config.mode === "time"
          ? generateTimeFallback({ config, wordPool, recentWords })
          : generateWordFallback({ config, wordPool, recentWords });
      }

      if (myToken !== loadTokenRef.current) {
        try { devLog('prompt:drop-stale', { token: myToken }); } catch {}
        return;
      }
      if (!finalized) throw new Error("Prompt finalization did not produce a result");

      const prepared: FinalizedSoloPrompt = {
        kind: "finalized-solo",
        text: finalized.text,
        seed: finalized.seed,
        requestedConfig: finalized.requestedConfig,
        effectiveConfig: finalized.effectiveConfig,
        resolvedDifficulty,
      };

      if (opts?.__prefetch) {
        prefetchedRef.current = { token: myToken, prompt: prepared };
        setPromptLoad('ready');
      } else {
        activePromptRef.current = prepared;
        specialRunConfigRef.current = null;
        appendSequenceRef.current = 0;
        initializedConfigRef.current = { ...prepared.requestedConfig };
        useLastTestStore.getState().save(prepared.requestedConfig);
        React.startTransition(() => {
          setIsTestComplete(false);
          setTime(0);
          setView('typing');
          setCurrentPrompt(prepared);
          setPromptLoad('ready');
        });
      }
      bootLockRef.current = false;
      try { tl('prompt->apply', { promptId: 'n/a' }); } catch {}
      try { devLog('prompt:apply'); } catch {}
    } catch (err: unknown) {
      if (myToken !== loadTokenRef.current) return;
      console.error('[prompt boot] error', err);
      const message = err instanceof Error
        ? err.message
        : (typeof err === 'object' && err && 'message' in err ? String((err as { message?: string }).message) : 'Failed to load prompt');
      setPromptError(message);
      setPromptLoad('error');
      bootLockRef.current = false;
      return;
    }
  }, [coderLang, createRequestedConfig, testMode]);

  const busyRef = useRef(false);
  const lastRestartRef = useRef<number>(0);
  const pendingRestartRef = useRef<TestGenerationConfigInput | null>(null);
  const cooldownTimerRef = useRef<number | null>(null);
  const COOLDOWN_MS = 1000;

  const handleRestart = useCallback(async (
    override: TestGenerationConfigInput = {},
  ) => {
    try { devLog('restartTest()', { override }); } catch {}
    // Force the page to the top BEFORE any state change so the typing column
    // (position:relative) renders below the fixed filter bar — regardless of
    // how far the user had scrolled the results page. Synchronous so it
    // happens before React processes the upcoming view transition.
    try { window.scrollTo(0, 0); } catch {}
    try { document.documentElement.scrollTop = 0; } catch {}
    try { document.body.scrollTop = 0; } catch {}
    // Clear prompt immediately to prevent typing on stale content
    setCurrentPrompt("");

    React.startTransition(() => {
      setIsTestComplete(false);
      setTime(0);
      setView('typing');
      setWpmSeries([]);
    });
    const hist = readHist();
    const avg = movingAvg(hist);
    setAvgWpm(avg.wpm);
    setAvgAcc(avg.acc);
    bootLockRef.current = false;
    try { tl('restartTest()', { reason: 'handleRestart', prevRunId: 'n/a' }); } catch {}
    // Skip prefetch fast-path for coder mode to avoid stale non-code prompts
    if (testMode !== 'coder') {
      const pf = prefetchedRef.current;
      if (pf?.prompt && Object.keys(override).length === 0) {
        prefetchedRef.current = null;
        activePromptRef.current = pf.prompt;
        specialRunConfigRef.current = null;
        appendSequenceRef.current = 0;
        initializedConfigRef.current = { ...pf.prompt.requestedConfig };
        useLastTestStore.getState().save(pf.prompt.requestedConfig);
        React.startTransition(() => {
          setCurrentPrompt(pf.prompt);
          setPromptLoad('ready');
        });
        return;
      }
      prefetchedRef.current = null;
    } else {
      // entering coder: ensure no prefetch leaks in
      prefetchedRef.current = null;
    }
    const config = testMode === "coder"
      ? undefined
      : createRequestedConfig(override);
    await loadPromptOnce({ config });
  }, [createRequestedConfig, loadPromptOnce, testMode]);

  const safeRestart = useCallback(async (
    override: TestGenerationConfigInput = {},
  ) => {
    // Snap to top synchronously on every restart entry path (including throttled ones)
    // before any work is queued. Cheap, idempotent, and bulletproofs the position.
    try { window.scrollTo(0, 0); } catch {}
    try { document.documentElement.scrollTop = 0; } catch {}
    try { document.body.scrollTop = 0; } catch {}
    const now = Date.now();
    const elapsed = now - lastRestartRef.current;

    // Helper: schedule a trailing run of the latest pending request
    const scheduleTrailing = (delayMs: number) => {
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      cooldownTimerRef.current = window.setTimeout(() => {
        const p = pendingRestartRef.current;
        if (!p) return;
        // attempt to flush the latest request
        pendingRestartRef.current = null;
        void safeRestart(p);
      }, Math.max(0, delayMs));
    };

    // If we can't run now, queue latest and schedule trailing
    if (busyRef.current || elapsed < COOLDOWN_MS) {
      pendingRestartRef.current = { ...override };
      const delay = busyRef.current ? 50 : (COOLDOWN_MS - elapsed + 10);
      scheduleTrailing(delay);
      return;
    }

    // We can run immediately
    lastRestartRef.current = now;
    busyRef.current = true;
    try {
      await handleRestart(override);
    } finally {
      busyRef.current = false;
      // If another request arrived while we were busy, flush it quickly
      if (pendingRestartRef.current) {
        const p = pendingRestartRef.current;
        pendingRestartRef.current = null;
        // allow paint/layout to settle
        setTimeout(() => { void safeRestart(p ?? {}); }, 0);
      }
      try {
        requestAnimationFrame(() => {
          try { recalcOffsets(); } catch {}
          // scrollIntoView removed - typing viewport uses fixed positioning (FIXED_TOP_OFFSET)
          // and should not shift on restart; scrolling would cause layout jumps
        });
      } catch {}
    }
  }, [handleRestart, recalcOffsets]);

  // Holds the latest restart function so click handlers don't use a stale closure
  const restartRef = React.useRef<typeof safeRestart | null>(null);

  // Update the ref as soon as a new render commits (layout phase)
  useLayoutEffect(() => {
    restartRef.current = safeRestart;
  }, [safeRestart]);

  // Small helper to defer to the next macrotask, guaranteeing the ref is set
  const nextTick = React.useCallback(() => new Promise<void>(resolve => setTimeout(resolve, 0)), []);

  // Unified path: enqueue a new test from any trigger
  const enqueueNewTest = useCallback((reason: string) => {
    const token = ++newReqTokenRef.current;
    try { tl('enqueueNewTest', { token, reason }); } catch {}
    if (applyingRef.current) return;
    applyingRef.current = true;
    try {
      if (typeof window !== 'undefined' && window.location.hash === '#new') {
        const { pathname, search } = window.location;
        window.history.replaceState(null, "", pathname + search);
        try { tl('hash cleared'); } catch {}
      }
    } catch {}
    void safeRestart?.().finally(() => {
      applyingRef.current = false;
    });
  }, [safeRestart]);

  // Initial boot – run once after mount, after bootConfigured and settings hydration
  const [hydrated, setHydrated] = React.useState<boolean>(() => {
    try { return (useSettingsStore as any)?.persist?.hasHydrated?.() ?? true; } catch { return true; }
  });
  React.useEffect(() => {
    const p = (useSettingsStore as any)?.persist;
    if (p?.onFinishHydration) {
      const unsub = p.onFinishHydration(() => setHydrated(true));
      if (p.hasHydrated?.()) setHydrated(true);
      return () => { try { unsub?.(); } catch {} };
    } else {
      setHydrated(true);
    }
  }, []);

  // Initial boot – run once after mount, after bootConfigured
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!bootConfigured) return;
    if (!hydrated) return;
    // Skip boot if deep link requests a new test; let enqueue path handle it
    if (window.location.hash === '#new') {
      return;
    }
    if (promptLoad !== 'idle') return;
    try { tl('boot->loadPromptOnce()'); } catch {}
    loadPromptOnce().then(() => { try { tl('boot->loadPromptOnce done'); } catch {} }).catch(() => {});
    return () => {
      try { bootAbortRef.current?.abort(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootConfigured, hydrated]);

  const handleStatsUpdate = (newWpm: number, newAccuracy: number, newTime: number) => {
    setWpm(newWpm);
    setAccuracy(newAccuracy);
    setTime(newTime);
    setIsTestComplete(false);
    setWpmSeries((prev) => upsertLatestWpmSample(prev, newTime, newWpm));
  };

  // Track difficulty changes to update prevDifficulty (animation removed)
  // useEffect(() => {
  //   const current = smartUsedDifficulty;
  //   if (current) setPrevDifficulty(current);
  // }, [smartUsedDifficulty]);

  // Honor deep link (#new) and a central NEW_TEST event
  useEffect(() => {
    if (typeof window === "undefined") return;

    console.info("[bk:new] typing= src/components/typing/TypingTest.tsx"); // remove after verification

    const onCustom = () => { try { tl('event BK_EVENTS.NEW_TEST'); } catch {} ; try { devLog('event BK_EVENTS.NEW_TEST'); } catch {} ; enqueueNewTest('event'); };

    const checkHash = () => {
      if (window.location.hash === "#new") {
        try { tl('hash #new detected (hashchange)'); } catch {}
        try { devLog('hash #new'); } catch {}
        enqueueNewTest('hash');
      }
    };

    // On mount and on hash changes
    if (window.location.hash === "#new") {
      try { devLog('hash #new (mount)'); } catch {}
      enqueueNewTest('mount');
    }
    window.addEventListener(BK_EVENTS.NEW_TEST as unknown as string, onCustom as EventListener);
    window.addEventListener("hashchange", checkHash);

    return () => {
      window.removeEventListener(BK_EVENTS.NEW_TEST as unknown as string, onCustom as EventListener);
      window.removeEventListener("hashchange", checkHash);
    };
  }, [enqueueNewTest]);

  // Prefetch next prompt while viewing results
  useEffect(() => {
    if (view !== 'results') return;
    const config =
      activePromptRef.current?.requestedConfig ?? createRequestedConfig();
    loadPromptOnce({ config, __prefetch: true }).catch(() => {});
  }, [createRequestedConfig, loadPromptOnce, view]);

  // AI Coach: practice launcher builds a 30-word custom drill
  const startCustomRun = useCallback((opts: { words: string[]; mode: 'words'|'time'; durationSec?: number }) => {
    if (opts.mode === 'words') {
      try { setTestMode('words'); } catch {}
      try { setMode('words'); } catch {}
      try { setWordCount(opts.words.length); } catch {}
    } else {
      try { setTestMode('time'); } catch {}
      try { setMode('time'); } catch {}
      if (typeof opts.durationSec === 'number') {
        try { setDurationSec(opts.durationSec); } catch {}
      }
    }
    const prompt = opts.words.join(' ');
    activePromptRef.current = null;
    specialRunConfigRef.current = specialRunConfig({
      text: prompt,
      mode: opts.mode,
      wordCount: opts.mode === "words" ? opts.words.length : null,
      durationSec:
        opts.mode === "time" ? opts.durationSec ?? DEFAULT_TIME_SEC : null,
      language: "english",
    });
    appendSequenceRef.current = 0;
    React.startTransition(() => {
      setIsTestComplete(false);
      setTime(0);
      setView('typing');
      setCurrentPrompt(prompt);
      setPromptLoad('ready');
    });
  }, []);

  const include_numbers = useSettingsStore(s => s.test.include_numbers);
  const include_punctuation = useSettingsStore(s => s.test.include_punctuation);

  const ensureExact = useCallback((ws: string[], n: number) => {
    if (ws.length === n) return ws;
    if (ws.length > n) return ws.slice(0, n);
    const filler: string[] = [];
    let i = 0;
    while (ws.length + filler.length < n && i < ws.length) filler.push(ws[i++]);
    return ws.concat(filler).slice(0, n);
  }, []);

  const runAIDrill = useCallback((count: number) => {
    const settings = useSettingsStore.getState();
    const intensity = settings.ai?.intensity ?? "med";
    const eps = intensity === "low" ? 0.05 : intensity === "high" ? 0.2 : 0.1;

    const base = getWordset(settings.test.wordSet ?? "core5000");
    const picks = weakspot.buildPracticeWordset(base, count, { 
      epsilon: eps, 
      maxPerFeature: 0.3, 
      minUniqueStems: 0.8 
    });
    
    const ensured = ensureExact(picks, count);
    const allowPunctuation = settings.test.include_punctuation === true;
    const allowNumbers = settings.test.include_numbers === true;
    const clean = sanitizePrompt(ensured.join(' '), { allowPunctuation, allowNumbers });
    try {
      const max = Number(settings?.test?.maxRepeatPerWord ?? 2);
      const arr = clean.split(' ').filter(Boolean);
      const limited = enforceNoRepeat(arr, {
        max,
        hardCap: 3,
        wordsetKey: settings?.test?.wordSet ?? "core5000",
        allowPunctuation,
        allowNumbers,
      });
      startCustomRun({ words: limited, mode: 'words' });
      return;
    } catch {}
    
    if (process.env.NODE_ENV !== "production") {
      console.debug("[coach] drill", { epsilon: eps, wordSet: settings.test.wordSet });
    }
    
    startCustomRun({ words: clean.split(' '), mode: 'words' });
  }, [include_numbers, include_punctuation, ensureExact, startCustomRun]);

  const runAIDrillTimed = useCallback((duration = 30) => {
    const settings = useSettingsStore.getState();
    const intensity = settings.ai?.intensity ?? "med";
    const eps = intensity === "low" ? 0.05 : intensity === "high" ? 0.2 : 0.1;

    // Use selected word set as base
    const base = getWordset(settings.test.wordSet ?? "core5000");
    // Not strictly necessary to rank for time mode, but do it anyway for a stronger opening:
    const picks = weakspot.buildPracticeWordset(base, 250, { 
      epsilon: eps, 
      maxPerFeature: 0.3, 
      minUniqueStems: 0.8 
    });
    
    const allowPunctuation = settings.test.include_punctuation === true;
    const allowNumbers = settings.test.include_numbers === true;
    const clean = sanitizePrompt(picks.join(' '), { allowPunctuation, allowNumbers });
    try {
      const max = Number(settings?.test?.maxRepeatPerWord ?? 2);
      const arr = clean.split(' ').filter(Boolean);
      const limited = enforceNoRepeat(arr, {
        max,
        hardCap: 3,
        wordsetKey: settings?.test?.wordSet ?? "core5000",
        allowPunctuation,
        allowNumbers,
      });
      startCustomRun({ words: limited, mode: 'time', durationSec: duration });
      return;
    } catch {}

    if (process.env.NODE_ENV !== "production") {
      console.debug("[coach] drill timed", { epsilon: eps, wordSet: settings.test.wordSet });
    }

    startCustomRun({ words: clean.split(' '), mode: 'time', durationSec: duration });
  }, [include_numbers, include_punctuation, startCustomRun]);

  const handlePracticeWeakSpots = useCallback(() => {
    runAIDrill(30);
  }, [runAIDrill]);

  const [syncState, setSyncState] = useState<"synced"|"queued"|"syncing"|"error">("synced");
  const handleTestComplete = async (finalWpm: number, finalAccuracy: number, finalTime: number, finalTypedText?: string) => {
    const completedPrompt = activePromptRef.current;
    const completedSpecialConfig = specialRunConfigRef.current;
    setIsTestComplete(true);
    setWpm(finalWpm);
    setAccuracy(finalAccuracy);
    setTime(finalTime);
    setWpmSeries((prev) => withOfficialFinalSample(prev, finalTime, finalWpm));

    const blazeOn = useSettingsStore.getState().test.blazeModeEnabled === true;

    if (blazeOn) {
      setBlazeUi("post");

      const tasks: Promise<unknown>[] = [];
      try {
        // 1) Prefetch next prompt for the upcoming run
        const config =
          completedPrompt?.requestedConfig ?? createRequestedConfig();
        tasks.push(loadPromptOnce({
          __prefetch: true,
          config,
        }));

        // 2) Hydrate totals now so results won't wait on it
        try {
          const hydrateTotals = useTotalsStore.getState().hydrate;
          tasks.push(Promise.resolve(hydrateTotals?.()));
        } catch {}

        // 3) Preload AI card chunk used on results
        tasks.push(import("@/components/feedback/AIFeedbackCardRevamp").then(() => undefined));
      } catch {}

      // Hold at least 3.5s; give tasks up to ~1.5s extra (max ~5s)
      const MIN = BLAZE_POST_MIN_MS; // 3500ms
      const EXTRA = 1500;
      await new Promise(res => setTimeout(res, MIN));
      await Promise.race([Promise.allSettled(tasks), new Promise(res => setTimeout(res, EXTRA))]);

      setView('results');
      // gentle fade-out overlap to avoid flicker
      setTimeout(() => setBlazeUi("off"), 250);
    } else {
      setView('results');
    }

    // Let the urgent results shell commit before history, analysis, persistence,
    // retry-queue, and auth-token work starts.
    await afterNextPaint();

    // update local history for adaptive difficulty
    try {
      const items = readHist();
      items.push({ wpm: finalWpm, acc: finalAccuracy, ts: Date.now() });
      writeHist(items);
    } catch {}

    // Guarantee a normalized history append for both modes (words/time)
    try {
      const used = completedPrompt?.effectiveConfig;
      const special = completedSpecialConfig;
      if (!used && !special) throw new Error("No active run config for history");
      const globalWithCrypto = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      const id = globalWithCrypto.crypto?.randomUUID ? globalWithCrypto.crypto.randomUUID() : String(Date.now());
      // append expects a run-like object; cast narrowly to avoid 'any'
      (useStatsStore.getState().append as unknown as (run: unknown) => void)({
        id,
        ts: Date.now(),
        wpm: finalWpm,
        acc: finalAccuracy,
        durationSec: Math.round(finalTime ?? 0),
        mode: used?.mode ?? special!.mode,
        words:
          (used?.mode ?? special!.mode) === "words"
            ? used?.wordCount ?? special?.wordCount ?? undefined
            : undefined,
      });
    } catch {}
    if (!finalTypedText) return;
    try {
      setSyncState("syncing");
      const { queued, data } = await postOrEnqueue<{ input: string; corrections: string[]; difficulty: string; feedback: string }>(
        "/analyze",
        { user_text: finalTypedText }
      );
      if (queued) {
        setSyncState("queued");
      } else {
        setSyncState("synced");
      }
      if (data) setAnalysisResult(data);
      if (!data && queued) {
        setAnalysisResult({
          input: finalTypedText,
          corrections: [],
          difficulty: "Unknown",
          feedback: "Queued for analysis. Will sync when online.",
        });
      }
    } catch (err) {
      setSyncState("error");
      setAnalysisResult({
        input: finalTypedText,
        corrections: [],
        difficulty: "Unknown",
        feedback: "Could not fetch AI feedback. Please ensure backend is running.",
      });
    }
    // Persist run to server (guest-safe). This is fire-and-forget from the
    // UI's perspective (we don't block on it), but it must never silently
    // lose data: on timeout/network failure/non-2xx we enqueue the exact
    // request into the persistent retry queue (src/lib/retryQueue.ts), which
    // is flushed on an interval and on `online` (see bootSync()/AppBoot).
    // Without this, a slow/aborted save would leave the optimistic local
    // append (above) as the *only* record of the run — looking "synced" in
    // this browser while never actually landing in Postgres/Firestore, so
    // it silently vanishes on any other device/browser for the same account.
    try {
      const completedConfig = completedPrompt?.effectiveConfig;
      const specialConfig = completedSpecialConfig;
      const payload = {
        mode: completedConfig
          ? completedConfig.mode === "time"
            ? `time/${completedConfig.durationSeconds}`
            : `words/${completedConfig.wordCount}`
          : specialConfig?.mode === "time"
            ? `time/${specialConfig.durationSec}`
            : `words/${specialConfig?.wordCount ?? 0}`,
        durationSec: Math.round(finalTime),
        wordsCount:
          completedConfig?.mode === "words"
            ? completedConfig.wordCount
            : specialConfig?.mode === "words"
              ? specialConfig.wordCount ?? undefined
              : undefined,
        wpm: Math.round(finalWpm),
        accuracy: Math.round(finalAccuracy),
      };

      // Validate payload before sending
      if (!Number.isFinite(payload.wpm) || !Number.isFinite(payload.accuracy) || !Number.isFinite(payload.durationSec)) {
        console.warn('[TypingTest] Invalid payload data, skipping API call:', payload);
        return;
      }

      const guestId = (() => {
        try {
          return localStorage.getItem('bk_guest_id') || (() => {
            const id = crypto.randomUUID();
            localStorage.setItem('bk_guest_id', id);
            return id;
          })();
        } catch {
          return null;
        }
      })();

      const { getIdTokenOptional } = await import("@/lib/idToken");
      let authHeader: Record<string, string> = {};
      try {
        const token = await getIdTokenOptional();
        if (token) authHeader = { Authorization: `Bearer ${token}` };
      } catch {
        // proceed without token; server will treat as guest
      }

      const runBody = { ...payload, guestId };
      const enqueueForRetry = async () => {
        try {
          const { enqueue } = await import("@/lib/retryQueue");
          await enqueue({ url: "/api/runs", method: "POST", body: runBody, headers: authHeader });
        } catch {}
      };

      // Generous timeout: a cold dev server (or a cold serverless start in
      // prod) compiling/initializing this route for the first time can
      // legitimately take longer than a typical request. We'd rather wait
      // than falsely conclude the save failed and duplicate it via the
      // retry queue.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      let response: Response;
      try {
        response = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify(runBody),
          credentials: 'include',
          signal: controller.signal,
        });
      } catch (networkErr) {
        clearTimeout(timeoutId);
        console.warn('[TypingTest] Run save failed (network/timeout), queued for retry:', networkErr);
        await enqueueForRetry();
        return;
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[TypingTest] Failed to save run, queued for retry:', response.status, response.statusText);
        await enqueueForRetry();
      } else {
        // Guardrail: reconcile with server truth in the background once the
        // write lands, so the account page reflects canonical data (e.g. on
        // another device/browser) rather than relying solely on the
        // optimistic local append above.
        try {
          const uid = useStatsStore.getState().uid;
          if (uid) void useStatsStore.getState().hydrate(uid);
        } catch {}
      }
    } catch (error) {
      console.warn('[TypingTest] Error saving run:', error instanceof Error ? error.message : error);
    }
  };

  // (old header/filter/stats measuring effect removed; consolidated above)
  const memoNewPrompt = React.useCallback(async () => { await safeRestart(); }, [safeRestart]);
  const memoAppendPrompt = React.useCallback(async (existingWords: string[]) => {
    const active = activePromptRef.current;
    if (!active || active.requestedConfig.mode !== "time") return "";
    appendSequenceRef.current += 1;
    const seed = (
      active.seed ^
      Math.imul(appendSequenceRef.current, 0x9e3779b9)
    ) >>> 0;
    const prng = mulberry32(seed);
    let lruList: string[] = [];
    try { lruList = JSON.parse(localStorage.getItem('bk-recent-words') || '[]'); } catch {}
    const lru = new StringLRU(400, Array.isArray(lruList) ? lruList : []);
    const base = getWordset(active.requestedConfig.wordSet);
    const add = buildAdaptiveBatch({ count: 120, poolSize: 600, prng, baseBank: base, avoid: lru });
    try { localStorage.setItem('bk-recent-words', JSON.stringify(lru.snapshot())); } catch {}
    return finalizeGeneratedPrompt({
      rawText: add.join(" "),
      config: active.requestedConfig,
      expectedTokenCount: 120,
      seed,
      wordPool: base,
      priorTokens: existingWords,
    }).text;
  }, []);

  // Consider a run active as soon as focus is on in typing view
  const isFocus = useUIStore((s) => s.isFocus);
  const blurWarning = useSettingsStore((s) => s.focus.blurWarning);
  const activeRun = view === 'typing' && !isTestComplete && isFocus;

  // Sync AI settings into AI Coach store
  const coachEnabled = useSettingsStore(s => (s as any).ai?.coachEnabled ?? true);
  const includeDigraphs = useSettingsStore(s => (s as any).ai?.includeDigraphs ?? true);
  const aiIntensity = useSettingsStore(s => (s as any).ai?.intensity ?? 'med');
  useEffect(() => {
    try { useAICoach.setState({ enabled: coachEnabled, includeDigraphs, intensity: aiIntensity }); } catch {}
  }, [coachEnabled, includeDigraphs, aiIntensity]);

  const activeFinalizedPrompt = isFinalizedSoloPrompt(currentPrompt)
    ? currentPrompt
    : null;
  const activeSpecialRunConfig = activeFinalizedPrompt
    ? null
    : specialRunConfigRef.current;

  return (
    <div ref={rootRef} className="min-h-dvh relative" data-view={view} data-run={isRunning ? 'true' : 'false'} data-bk-generating={promptLoad === 'loading' && !currentPrompt ? 'true' : 'false'}>
      {/* Visual-only out-of-focus notice */}
      {(() => { try { console.debug('[bk] activeRun=', activeRun); } catch {} ; return null; })()}
      {blurWarning && (
        <OutOfFocusNotice activeRun={activeRun} />
      )}
      {/* Top Navigation/Filter Bar */}
      {/* Pin the filter bar to the top of the viewport (fixed), higher than before */}
      <PreTestOverlay show={view !== 'results' && !(view === 'typing' && !isTestComplete && time > 0)} position="fixed" z="z-40">
        <div ref={filterRef} className="max-w-7xl mx-auto px-6 py-4">
          {/* Main Mode Selection */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            {/* Special Features */}
            <ClickOnly
              className={clsx(
                "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                "bk-chip bk-focus",
                showPunctuation 
                  ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 shadow-yellow-400/25 hover:shadow-yellow-400/40 bk-chip--active' 
                  : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
              )}
              aria-pressed={showPunctuation}
              onClick={async () => {
                const next = !showPunctuation;
                setShowPunctuation(next);
                await safeRestart({ includePunctuation: next });
              }}
            >
              <AtSign className="h-4 w-4" />
              punctuation
              {showPunctuation && <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>}
            </ClickOnly>
            
            <ClickOnly
              className={clsx(
                "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                "bk-chip bk-focus",
                showNumbers 
                  ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 shadow-yellow-400/25 hover:shadow-yellow-400/40 bk-chip--active' 
                  : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
              )}
              aria-pressed={showNumbers}
              onClick={async () => {
                const next = !showNumbers;
                setShowNumbers(next);
                await safeRestart({ includeNumbers: next });
              }}
            >
              <Hash className="h-4 w-4" />
              numbers
              {showNumbers && <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>}
            </ClickOnly>
            
            {/* Separator */}
            <div className="w-px h-8 bg-gradient-to-b from-transparent via-gray-600/50 to-transparent mx-3"></div>
            
            {/* Test Modes */}
            <div className="bk-segment bk-filter-row">
              <button 
                className={clsx(
                  "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                  "bk-segment__item bk-focus",
                  testMode === 'time' 
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-blue-500/25 hover:shadow-blue-500/40' 
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
                )}
                aria-pressed={testMode === 'time'}
                onClick={async () => {
                  // clear prefetch when switching modes
                  prefetchedRef.current = null;
                  const nextDuration = enteredRef.current.time
                    ? durationSec
                    : DEFAULT_TIME_SEC;
                  flushSync(() => {
                    setTestMode('time');
                    setMode('time');
                    if (!enteredRef.current.time) {
                      setDurationSec(DEFAULT_TIME_SEC);
                      enteredRef.current.time = true;
                    }
                    setView('typing');
                  });
                  await nextTick();
                  await restartRef.current?.({
                    mode: "time",
                    durationSeconds: nextDuration,
                  });
                }}
              >
                <Clock className="h-4 w-4" />
                time
              </button>
              
              <button 
                className={clsx(
                  "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                  "bk-segment__item bk-focus",
                  testMode === 'words' 
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-purple-500/25 hover:shadow-purple-500/40' 
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
                )}
                aria-pressed={testMode === 'words'}
                onClick={async () => {
                  prefetchedRef.current = null;
                  flushSync(() => {
                    setTestMode('words');
                    setMode('words');
                    if (!enteredRef.current.words) {
                      setWordCount(DEFAULT_WORDS);
                      enteredRef.current.words = true;
                    }
                    setView('typing');
                  });
                  await nextTick();
                  await restartRef.current?.({
                    mode: "words",
                    wordCount: DEFAULT_WORDS,
                  });
                }}
              >
                <span className="text-lg font-bold">A</span>
                words
              </button>
              
              <button 
                className={clsx(
                  "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                  "bk-segment__item bk-focus",
                  testMode === 'coder' 
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-500/25 hover:shadow-emerald-500/40' 
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
                )}
                aria-pressed={testMode === 'coder'}
                onClick={async () => {
                  // prevent prefetch fast-path from injecting a non-code prompt
                  prefetchedRef.current = null;
                  flushSync(() => {
                    setTestMode('coder');
                    setMode('words');
                    setWordCount(25);
                    if (!enteredRef.current.coder) {
                      enteredRef.current.coder = true;
                    }
                    setView('typing');
                  });
                  await nextTick();
                  await restartRef.current?.();
                }}
              >
                {"<> coder"}
              </button>
              
              <button 
                className={clsx(
                  "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                  "bk-segment__item bk-focus",
                  testMode === 'zen' 
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40' 
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
                )}
                aria-pressed={testMode === 'zen'}
                onClick={() => setTestMode('zen')}
              >
                <Triangle className="h-4 w-4" />
                zen
              </button>
              
              <button 
                className={clsx(
                  "group relative px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 hover:scale-105 flex items-center gap-2 shadow-lg",
                  "bk-segment__item bk-focus",
                  testMode === 'custom' 
                    ? 'bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-rose-500/25 hover:shadow-rose-500/40' 
                    : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm'
                )}
                aria-pressed={testMode === 'custom'}
                onClick={() => setTestMode('custom')}
              >
                <Wrench className="h-4 w-4" />
                custom
              </button>
            </div>
          </div>

          {/* Secondary Options Row */}
          <div className="flex items-center justify-between">
            {/* Duration/Count Options */}
            <div className="flex items-center gap-2 bk-filter-row">
              {testMode === 'time' && (
                <div className="flex items-center gap-2 bg-gray-800/30 backdrop-blur-sm border border-gray-700/30 rounded-xl p-1 bk-segment">
                  {[15, 30, 60, 120].map((duration) => (
                    <button 
                      key={duration}
                      className={clsx(
                        "px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 relative overflow-hidden",
                        "bk-segment__item bk-focus",
                        durationSec === duration 
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25' 
                          : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-300'
                      )}
                      aria-pressed={durationSec === duration}
              onClick={async () => {
                setDurationSec(duration);
                setView('typing');
                await safeRestart({
                  mode: "time",
                  durationSeconds: duration,
                });
              }}
                    >
                      {duration}s
                      {durationSec === duration && (
                        <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {testMode === 'words' && (
                <div className="flex items-center gap-2 bg-gray-800/30 backdrop-blur-sm border border-gray-700/30 rounded-xl p-1 bk-segment">
                  {[10, 15, 20, 30, 50].map((count) => (
                    <button 
                      key={count}
                      className={clsx(
                        "px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 relative overflow-hidden",
                        "bk-segment__item bk-focus",
                        wordCount === count 
                          ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25' 
                          : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-300'
                      )}
                      aria-pressed={wordCount === count}
              onClick={async () => {
                setWordCount(count);
                await safeRestart({ mode: "words", wordCount: count });
              }}
                    >
                      {count}
                      {wordCount === count && (
                        <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {testMode === 'coder' && (
                <CoderLanguageChips
                  className="ml-2"
                  value={coderLang}
                  onChange={async (v) => {
                    setCoderLang(v);
                    setMode('words');
                    setWordCount(25);
                    setView('typing');
                    await safeRestart();
                  }}
                />
              )}
            </div>

            {/* Right controls: Blaze toggle + language */}
            <div className="flex items-center gap-3">
              {isHydrated && (
                <Tooltip.TooltipProvider delayDuration={150}>
                  <Tooltip.Tooltip>
                    <Tooltip.TooltipTrigger asChild>
                      <div className="flex items-center gap-2 bg-gray-800/30 backdrop-blur-sm border border-gray-700/30 rounded-xl px-3 py-2">
                        <span className="text-xs uppercase tracking-wider text-gray-400">Blaze mode (AI)</span>
                        <Switch
                          checked={blazeEnabled}
                          onCheckedChange={async (v) => {
                            useSettingsStore.getState().update("test", { blazeModeEnabled: !!v });
                            if (v) {
                              // Show interlude for a guaranteed 3s while regenerating
                              setBlazeUi("toggle");
                              const t0 = performance.now();
                              const minDelay = new Promise(res => setTimeout(res, BLAZE_TOGGLE_MIN_MS));
                              const restart = safeRestart();
                              await Promise.all([minDelay, restart]);
                              // allow a small fade-out overlap
                              setTimeout(() => setBlazeUi("off"), 200);
                            } else {
                              await safeRestart();
                            }
                          }}
                        />
                      </div>
                    </Tooltip.TooltipTrigger>
                    <Tooltip.TooltipContent>AI adapts your next test using your recent results.</Tooltip.TooltipContent>
                  </Tooltip.Tooltip>
                </Tooltip.TooltipProvider>
              )}

              {/* Language Selector */}
              <button data-lang-pill className="group px-5 py-3 rounded-2xl text-sm font-semibold bg-gray-800/50 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30 hover:border-gray-600/50 backdrop-blur-sm transition-all duration-300 flex items-center gap-2 shadow-lg hover:scale-105 bk-lang bk-focus">
                <Globe className="h-4 w-4 group-hover:rotate-12 transition-transform duration-300" />
                english
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              </button>
            </div>
          </div>
          {/* Floating toast anchored to language pill */}
          {!isTestComplete && <ReadyToast />}

          {/* Inline error notice positioned below the filter bar */}
          {promptLoad === 'error' && !currentPrompt && (
            <div className="pointer-events-auto mx-auto mt-6 sm:mt-8 max-w-md">
              <div className="flex flex-col items-center gap-2 text-orange-200/80">
                <div className="text-sm">Couldn’t generate a test.</div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 rounded-md bg_WHITE/10 ring-1 ring-white/15 hover:bg-white/15"
                    onClick={() => { bootLockRef.current = false; loadPromptOnce().catch(()=>{}); }}
                  >
                    Try again
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-md bg-orange-500/15 ring-1 ring-orange-400/25 hover:ring-orange-300/40"
                    onClick={() => { bootLockRef.current = false; loadPromptOnce({ useFallback: true }).catch(()=>{}); }}
                  >
                    Use offline prompt
                  </button>
                </div>
                {promptError && <div className="text-[11px] opacity-70">{promptError}</div>}
              </div>
            </div>
          )}
        </div>
      </PreTestOverlay>

      {/* Live Stats Bar - typing ONLY (hide in results) */}
      {view === 'typing' && time > 0 && !isTestComplete && (
        <div ref={statsRef} className="bk-stats-bar sticky z-40 hide-on-test" aria-hidden={view === 'typing' && !isTestComplete && time > 0}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="bk-stats-row">
              {/* WPM */}
              <div className="flex items-center gap-3 group bk-stat" role="status" aria-live="polite">
                <span className="bk-stat__icon flex items-center justify_center w-10 h-10 rounded-xl border border-yellow-400/30 bg-gradient_to-br from-yellow-400/20 to-orange-500/20">
                  <Zap className="w-5 h-5 text-yellow-400" />
                </span>
                <div>
                  <div className="text-2xl font-bold text-yellow-400 font-mono leading-none bk-stat__value">
                    {wpm}
                  </div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider bk-stat__label">WPM</div>
                </div>
              </div>

              {/* Accuracy */}
              <div className="flex items-center gap-3 group bk-stat" role="status" aria-live="polite">
                <span className="bk-stat__icon flex items-center justify_center w-10 h-10 rounded-xl border border-green-400/30 bg-gradient_to-br from-green-400/20 to-emerald-500/20">
                  <Target className="w-5 h-5 text-green-400" />
                </span>
                <div>
                  <div className="text-2xl font-bold text-green-400 font-mono leading-none bk-stat__value">
                    {accuracy}%
                  </div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider bk-stat__label">Accuracy</div>
                </div>
              </div>

              {/* Time */}
              <div className="flex items-center gap-3 group bk-stat" role="status" aria-live="polite">
                <span className="bk-stat__icon flex items_center justify_center w-10 h-10 rounded-xl border border-blue-400/30 bg-gradient_to-br from-blue-400/20 to-cyan-500/20">
                  <Timer className="w-5 h-5 text-blue-400" />
                </span>
                <div>
                  <div className="text-2xl font-bold text-blue-400 font-mono leading-none bk-stat__value">
                    {time.toFixed(1)}s
                  </div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider bk-stat__label">Time</div>
                </div>
              </div>

              {/* Smart Test badge */}
              {activeFinalizedPrompt?.resolvedDifficulty && (
                <span className="bk-badge bk-badge--fire">AI Smart Test — {activeFinalizedPrompt.resolvedDifficulty}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 relative bk-surface-glow">

        {view === 'typing' && (
          <>
            {/* Loader skeleton - ABSOLUTE positioned to not affect TypingBox layout */}
            {promptLoad === 'loading' && !currentPrompt && (
              <div className="absolute inset-x-0 top-[260px] px-6 py-8 pointer-events-none z-10">
                <div className="animate-pulse space-y-3 max-w-7xl mx-auto">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="h-5 rounded-md bg-white/10" />
                  ))}
                </div>
              </div>
            )}
            {promptLoad === 'error' && !currentPrompt && null}

            {/* TypingBox - always rendered at fixed position regardless of loading state */}
            <div
              className="typing-offsetter"
              style={{ paddingTop: 0 }}
            >
            <TypingBox 
              mode={mode}
              durationSec={durationSec}
              onStatsUpdate={handleStatsUpdate}
              onTestComplete={handleTestComplete}
              prompt={currentPrompt}
              isLoading={promptLoad === 'loading'}
              onRequestNewPrompt={memoNewPrompt}
              onRequestAppendPrompt={memoAppendPrompt}
            />
            </div>
          </>
        )}
        {/* Single, centered logo loader */}
        <LogoLoader show={promptLoad === 'loading' && !currentPrompt} />
        {/* AI interlude overlay (toggle-on & post-run) */}
        <BlazeInterlude
          show={blazeUi !== 'off'}
          context={blazeUi === 'post' ? 'post' : 'toggle'}
        />
        {view === 'results' && (
          <div className="mt-6 md:mt-10">
            <ResultsPanel
              wpm={wpm}
              accuracy={accuracy}
              time={time}
              analysis={analysisResult}
              wpmSeries={wpmSeries}
              avgWpm={avgWpm}
              avgAcc={avgAcc}
              promptMetadata={activeFinalizedPrompt ?? undefined}
              flags={activeSpecialRunConfig ? {
                punctuation: activeSpecialRunConfig.include_punctuation,
                numbers: activeSpecialRunConfig.include_numbers,
              } : undefined}
              usedConfig={activeSpecialRunConfig ?? undefined}

              onNextTest={async () => { try { tl('results New test click'); } catch {} ; await safeRestart(); }}
              onPracticeWeakSpots={handlePracticeWeakSpots}
              onPracticeWeakSpotsTimed={() => runAIDrillTimed(30)}
            />
          </div>
        )}
      </div>

      {/* Results render via view switch above */}

      {/* Bottom Helper Bar - Only show during active typing */}
      {/* Bottom commands/hotkeys bar removed for typing view per spec */}

      {/* Old bottom-corner hint removed in favor of ReadyToTypeHint under controls */}
      <LatencyHUD />
    </div>
  );
};

export default TypingTest;
