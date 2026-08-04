"use client"

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { saveTypingResult } from '@/lib/firebase/scores';
import { computeXpAward } from '@/lib/xp';
import { useStatsStore } from '@/stores/useStatsStore';
import { addLocalRun, BlazeRun } from "@/lib/historyLocal";
import { RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { segmentGraphemes, normalizeInputChar } from "@/utils/segments";
import { evalWord, type WordEval } from "@/lib/typing/state";
import { tallyWords, wpmFromTally, accuracyFromTally } from "@/lib/typing/metrics";
import { createRafQueue } from "@/lib/rafQueue";
import { useStopOnError, useStrictSpace, useSettingsStore } from "@/store/settings";
import { enforceNoRepeat } from "@/lib/prompt/noRepeatLimiter";
import { useUIStore } from "@/stores/useUIStore";
import EmbersLayer, { EmbersHandle } from "@/components/fx/EmbersLayer";
import { useSearchParams } from "next/navigation";
import { tl } from "@/lib/timeline";
import { trace } from "@/utils/debugTrace";
import { devLog } from "@/lib/devLog";
import useLockScroll from "@/hooks/useLockScroll";
import { useInputLatencyProbe } from "@/hooks/useInputLatencyProbe";
import { officialWpm, accuracy as accFn } from "@/lib/statsMath";
import {
  isFinalizedSoloPrompt,
  promptText,
  type TypingPrompt,
} from "@/lib/prompt/preparedPrompt";
import { computeWordLineLayout, calculateViewportTop, applyViewportTransform, VISIBLE_LINES, type LineLayout } from "@/lib/textLayout";
import { useReducedMotion } from "framer-motion";
import { weakspot } from "@/ai/weakspot";

/* NEW – bring in the modernised Shadcn results panel */
// Legacy StatsPanel removed in favor of modern ResultsPanel

/* ─────────────────────────────────────────────────────────── */

// Dev-only layout shift instrumentation
const DEBUG_LAYOUT = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_LAYOUT === '1';

function captureViewportRect(viewportEl: HTMLElement | null): DOMRect | null {
  if (!viewportEl) return null;
  return viewportEl.getBoundingClientRect();
}

function logLayoutShift(before: DOMRect | null, after: DOMRect | null, context: string) {
  if (!DEBUG_LAYOUT || !before || !after) return;
  const dx = Math.round(after.left - before.left);
  const dy = Math.round(after.top - before.top);
  if (dx !== 0 || dy !== 0) {
    console.warn(`[LAYOUT_SHIFT] ${context}: dx=${dx}px, dy=${dy}px`, { before, after });
  } else {
    console.log(`[LAYOUT_STABLE] ${context}: no shift detected`);
  }
}

/**
 * Optional, fully gated party-mode integration. When this prop is omitted
 * (the default for solo typing), TypingBox behaves EXACTLY as before — no
 * extra work happens in the keystroke path. When present, the engine calls
 * `onProgress` once per stat-tick with a snapshot of the local cursor and
 * stats. The hook is fire-and-forget: it MUST return synchronously and
 * MUST NOT throw (TypingBox swallows errors defensively as well).
 */
export interface TypingBoxPartyHook {
  onProgress?: (sample: {
    /** Canonical char index into the *expected* prompt (not typed input). */
    charIndex: number;
    correctChars: number;
    incorrectChars: number;
    wpm: number;
    accuracy: number;
    elapsedMs: number;
  }) => void;
}

export interface TypingBoxProps {
  mode: 'time' | 'words';
  durationSec?: number;
  onStatsUpdate: (wpm: number, accuracy: number, time: number) => void;
  onTestComplete: (wpm: number, accuracy: number, time: number, typedInput: string) => void;
  prompt: TypingPrompt;
  onRequestNewPrompt?: () => void;
  onRequestAppendPrompt?: (existingWords: string[]) => Promise<string>;
  isLoading?: boolean;
  /** Optional party-mode hook. Absent = solo typing (default). */
  party?: TypingBoxPartyHook;
}

// Timestamped key event for rAF-batched processing
type KeyEvent = { k: string; __ts?: number };

const TypingBox: React.FC<TypingBoxProps> = ({ mode, durationSec = 15, onStatsUpdate, onTestComplete, prompt, onRequestNewPrompt, onRequestAppendPrompt, isLoading: externalLoading = false, party }) => {
  const finalizedSolo = isFinalizedSoloPrompt(prompt);
  // Stable ref so we don't put `party` in any deps that would re-run on
  // every parent render. Solo mode keeps this ref undefined and pays zero cost.
  const partyRef = useRef<TypingBoxPartyHook | undefined>(party);
  useEffect(() => { partyRef.current = party; }, [party]);
  // Fallback line-height in px; the measurement effect below replaces this with the
  // computed line-height of the rendered prompt so scroll math tracks the actual font.
  // 44 is a safe small-viewport fallback; on larger viewports the measured value will
  // be used (line-height is unitless 1.5 in CSS, so it flows with the clamped font-size).
  const LINE_H = 44;
  // Line-height ratio (unitless). Used both in CSS (scales with font-size) and to
  // build the viewport height as ems so it tracks the prompt font on every viewport.
  const LINE_RATIO = 1.5;
  // Scale used for all typing prompts (visual-only; no layout reflow)
  // Changed from 1.3 to 1 for cross-monitor consistency (avoids DPI-dependent transform scaling)
  const PROMPT_SCALE = 1;
  // Shared font-size clamp string for the prompt — kept in one place so both the
  // viewport height calc and the content font-size stay in lockstep.
  const PROMPT_FONT_SIZE = "clamp(1.35rem, 1.05rem + 1.1vw, 2.25rem)";

  const searchParams = useSearchParams();
  const debug = searchParams.get('debug') === '1';
  const debugType = searchParams.get('debugType') === '1';
  const debugPaused = searchParams.get('debugPaused') === '1';

  const { user } = useAuth();

  const [words, setWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [inputWords, setInputWords] = useState<string[]>([]); // per-word inputs
  const [cursorCol, setCursorCol] = useState(0);              // column within current word
  const [hasStarted, setHasStarted] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [correctChars, setCorrectChars] = useState(0);
  const [totalChars, setTotalChars] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [debugLog, setDebugLog] = useState<any[]>([]);
  const [awardedThisRun, setAwardedThisRun] = useState(false);
  const [time, setTime] = useState(0);

  // Viewport state
  const [visibleStartLine, setVisibleStartLine] = useState(0);
  const [lineLayout, setLineLayout] = useState<LineLayout>({ wordIndexToLine: [], totalLines: 0, lineHeight: 38 });
  
  // Append buffer state
  const appendBusyRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // Refs for DOM measurement and viewport calculations
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const baseTopRef = useRef(0);
  const lineHeightRef = useRef(LINE_H);
  const wordLineRef = useRef<number[]>([]);
  const lineEndsRef = useRef<number[]>([]);
  const lastLineRef = useRef(0);
  // Dev-only: track last per-char status to log flips from incorrect -> other
  const lastStatusRef = useRef<Record<string, 'correct' | 'incorrect' | 'cursor' | 'untyped'>>({});
  const isCompletedRef = useRef(false);

  // NEW: write-through refs to avoid stale React state between rAF batches
  const inputWordsRef = useRef<string[]>([]);
  const currentWordIndexRef = useRef(0);
  const cursorColRef = useRef(0);
  const hasStartedRef = useRef(false);
  useEffect(() => { inputWordsRef.current = inputWords; }, [inputWords]);
  useEffect(() => { currentWordIndexRef.current = currentWordIndex; }, [currentWordIndex]);
  useEffect(() => { cursorColRef.current = cursorCol; }, [cursorCol]);
  useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);

  // Tab/restart handling
  const isTabHeldRef = useRef(false);
  const lastTabDownAtRef = useRef(0);
  const endAtRef = useRef<number>(0);
  const lastDownAtRef = useRef<number | null>(null);
  const lastCharRef = useRef<string | null>(null);
  const nowTs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ---- debug sink (devtools) ----
  const dbgLogRef = useRef<any[]>([]);
  useEffect(() => {
    (window as any).bkRun = {
      log: dbgLogRef.current,
      clear: () => { dbgLogRef.current.length = 0; },
      state: () => ({
        wi: currentWordIndex,
        col: cursorCol,
        words,
        input: inputWords,
      }),
    };
  }, [currentWordIndex, cursorCol, words, inputWords]);

  // keep center-of-window invariant no matter the mode
  const TOTAL_LINES = 3;
  const CENTER_OFFSET = 1; // active line stays centered: 0 (top), 1 (middle), 2 (bottom)

  // for time mode: keep a trailing buffer so we never run out of words
  const APPEND_THRESHOLD_WORDS = 40;  // when within 40 words of the end, append more
  const APPEND_CHUNK_DEFAULT = 120;   // how many words to append per fetch
  const appendingRef = useRef(false);

  // Bottom breathing room (rem so it scales with the tiered --bk-ui-scale).
  const SAFE_BOTTOM_REM = 3;

  // Gates centering/transform until after we have real measurements
  const [measured, setMeasured] = React.useState(false);

  // ---- input buffering while prompt is not yet ready ----
  const bufferRef = useRef<string[]>([]);
  const readyRef = useRef<boolean>(false);
  const promptReady = useMemo(() => (words.length > 0 && !externalLoading && !isLoading), [words.length, externalLoading, isLoading]);
  useEffect(() => { readyRef.current = !!promptReady; }, [promptReady]);
  const flushBuffer = useCallback(() => {
    if (!readyRef.current) return;
    if (!bufferRef.current.length) return;
    const batch = bufferRef.current.splice(0, bufferRef.current.length);
    try { trace('BUFFER_FLUSH', { count: batch.length }); } catch {}
    for (const ch of batch) enqueueKey(ch);
  }, []);
  useEffect(() => { if (promptReady) flushBuffer(); }, [promptReady]);

  // Lock page scroll any time the typing screen is visible.
  // Pre-test (not started) -> locked
  // Active run -> locked
  // Post-test/results (isComplete) -> unlocked
  const scrollLocked = !isComplete;
  // CRITICAL: snap the page to scrollY=0 BEFORE the lock engages.
  // This useLayoutEffect runs synchronously after DOM commit (before paint)
  // and BEFORE useLockScroll's useEffect fires. If the user just came from
  // the results page (which uses normal document scroll), scrollY may be
  // non-zero, which would visually push the position:relative typing column
  // up — causing it to overlap the fixed filter bar. Resetting here, before
  // the lock freezes the scroll position, guarantees consistent placement.
  useLayoutEffect(() => {
    try { window.scrollTo(0, 0); } catch {}
    try { document.documentElement.scrollTop = 0; } catch {}
    try { document.body.scrollTop = 0; } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLockScroll(scrollLocked);
  const devProbe = process.env.NEXT_PUBLIC_DEV_PROBE === "1";
  useInputLatencyProbe(devProbe, [currentWordIndex, cursorCol]);

  // --- Re-run stabilizer state ---
  const [runSeq, setRunSeq] = React.useState(0);

  // --- Hard reset of viewport/metrics before a new test is applied ---
  const resetViewport = React.useCallback(() => {
    // stop using previous measurements
    setMeasured(false);
    setVisibleStartLine(0);

    // clear measurement bookkeeping
    lastLineRef.current = 0;
    wordLineRef.current = [];
    appendingRef.current = false;
    if (contentRef.current) {
      contentRef.current.style.transform = "translateY(0px)";
    }
    
    // Reset caret mover on test restart
    if (caretMoverRef.current) {
      caretMoverRef.current.reset();
    }
  }, []);

  // Settings flags
  const stopOnError = useStopOnError();
  const strictSpace = useStrictSpace();
  const overlayOpen = useUIStore(s => s.overlayOpen);
  const setFocus = useUIStore(s => s.setFocus);
  const focusEnabled = useSettingsStore(s => s.focus.enabled);
  const exitOnMouseMove = useSettingsStore(s => s.focus.exitOnMouseMove);
  const isFocus = useUIStore(s => s.isFocus);

  // FX layer
  const emberRef = React.useRef<EmbersHandle>(null);
  // Caret overlay anchors
  const promptWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const caretMoveTimer = useRef<number | null>(null);
  
  // Smooth caret mover
  const caretMoverRef = useRef<ReturnType<typeof import("@/lib/caretMotion").createCaretMover> | null>(null);

  function calculateWPM(correct: number, timeInSeconds: number): number {
    if (timeInSeconds <= 0) return 0;
    return Math.round((correct / 5) / (timeInSeconds / 60));
  }

  function calculateAccuracy(correct: number, total: number): number {
    if (total === 0) return 100;
    return Math.round((correct / total) * 100);
  }

  const appendMoreWordsIfNeeded = useCallback(async (wi: number) => {
    if (mode !== 'time') return;
    const remaining = (words.length - 1) - wi;
    if (remaining > APPEND_THRESHOLD_WORDS) return;
    if (appendingRef.current) return;
    // only append if a callback is provided
    if (!onRequestAppendPrompt) return;

    try {
      appendingRef.current = true;
      const extra = await onRequestAppendPrompt(words);
      if (!extra || !extra.trim()) return;
      const add = extra.split(/\s+/).filter(Boolean);
      if (!add.length) return;

      if (finalizedSolo) {
        setWords((previous) => previous.concat(add));
        setInputWords((previous) => previous.concat(Array(add.length).fill("")));
        return;
      }

      // append words and expand input slots (with repeat limiter)
      try {
        const settings = useSettingsStore.getState?.();
        const max = Number(settings?.test?.maxRepeatPerWord ?? 2);
        const allowPunctuation = settings?.test?.include_punctuation === true;
        const allowNumbers = settings?.test?.include_numbers === true;
        setWords(prev => {
          const combined = prev.concat(add);
          const limited = enforceNoRepeat(combined, {
            max,
            hardCap: 3,
            wordsetKey: settings?.test?.wordSet ?? "core5000",
            allowPunctuation,
            allowNumbers,
          });
          // expand inputs to new length
          setInputWords(p => p.concat(Array(Math.max(0, limited.length - p.length)).fill("")));
          return limited;
        });
        return;
      } catch {}

      // fallback (no limiter)
      setWords(prev => prev.concat(add));
      setInputWords(prev => prev.concat(Array(add.length).fill("")));
      // line map gets recomputed by existing effects when `words` changes
    } finally {
      appendingRef.current = false;
    }
  }, [mode, words.length, onRequestAppendPrompt, finalizedSolo]);

  const clampTop = useCallback((top: number) => {
    const maxLines = Math.max(1, lineLayout.totalLines);
    const maxStart = Math.max(0, maxLines - TOTAL_LINES);
    return Math.max(0, Math.min(maxStart, top));
  }, [lineLayout.totalLines]);

  const targetStream = useMemo(() => words.join(' '), [words]);

  // Ghost-cursor hook: precompute the global char offset of each word's first
  // character in `words.join(' ')` so character spans can be stamped with a
  // stable `data-bk-ci` attribute for DOM look-up by GhostCursor.
  // ONLY computed when a party hook is present — zero cost in solo mode.
  const wordStartIndices = useMemo<number[] | null>(() => {
    if (!party) return null;
    const indices: number[] = [];
    let offset = 0;
    for (const word of words) {
      indices.push(offset);
      offset += word.length + 1; // +1 for the inter-word space
    }
    return indices;
  }, [party, words]);

  // Computed word evaluations (persistent per-char states)
  const evals = useMemo<WordEval[]>(() => {
    return words.map((w, i) => evalWord(w, inputWords[i] ?? ""));
  }, [words, inputWords]);

  /* ───────── Load prompt from prop ───────── */
  const resetFromPrompt = useCallback((prepared: TypingPrompt) => {
    const text = promptText(prepared);
    const skipMutation = isFinalizedSoloPrompt(prepared);
    // Dev-only: capture viewport position before reset
    const viewportEl = containerRef.current?.querySelector('[data-bk-viewport]') as HTMLElement | null;
    const beforeRect = DEBUG_LAYOUT ? captureViewportRect(viewportEl) : null;
    
    readyRef.current = false; // block input until prompt is fully applied
    try { trace('PROMPT_APPLY', { length: text?.length ?? 0 }); } catch {}
    resetViewport();
    setRunSeq((x) => x + 1);
    setIsLoading(true);
    let nextWords = text.split(" ").filter(Boolean);
    // Finalized solo prompts already passed the shared deterministic mutation
    // boundary. Party and legacy string prompts retain the existing limiter.
    if (!skipMutation) try {
      const settings = useSettingsStore.getState?.();
      const max = Number(settings?.test?.maxRepeatPerWord ?? 2);
      const allowPunctuation = settings?.test?.include_punctuation === true;
      const allowNumbers = settings?.test?.include_numbers === true;
      const limited = enforceNoRepeat(nextWords, {
        max,
        hardCap: 3,
        wordsetKey: settings?.test?.wordSet ?? "core5000",
        allowPunctuation,
        allowNumbers,
      });
      if (Array.isArray(limited) && limited.length === nextWords.length) nextWords = limited;
      if (process.env.NODE_ENV !== "production") {
        // quick dev assertion (largest frequency <= hardCap)
        const freq = new Map<string, number>();
        for (const w of nextWords) freq.set(w, (freq.get(w) ?? 0) + 1);
        let worst = 0; for (const v of freq.values()) worst = Math.max(worst, v);
        // eslint-disable-next-line no-console
        console.assert(worst <= 3, "[TypingBox.resetFromPrompt] repeat cap exceeded", { worst });
      }
    } catch {}
    setWords(nextWords);
    setInputWords(Array(nextWords.length).fill(""));
    setCurrentWordIndex(0);
    setCursorCol(0);
    setHasStarted(false);
    setStartTime(null);
    setIsComplete(false);
    // Keep refs consistent with the reset to avoid cross-run carryover
    inputWordsRef.current = Array(nextWords.length).fill("");
    currentWordIndexRef.current = 0;
    cursorColRef.current = 0;
    hasStartedRef.current = false;
    isCompletedRef.current = false;
    setCorrectChars(0);
    setTotalChars(0);
    setIsLoading(false);
    setVisibleStartLine(0);
    if (contentRef.current) contentRef.current.style.transform = `translateY(0px)`;
    lastLineRef.current = 0;
    wordLineRef.current = [];
    appendingRef.current = false;
    try { weakspot.resetRun(); } catch {}
    lastDownAtRef.current = null;
    lastCharRef.current = null;
    // Defer 'ready' to the next frame so the new words are rendered before we accept input.
    try { trace('READY_SCHEDULED'); } catch {}
    requestAnimationFrame(() => {
      readyRef.current = true;
      try { trace('READY_TRUE'); } catch {}
      if (bufferRef.current.length) {
        const pending = bufferRef.current.splice(0);
        try { trace('BUFFER_FLUSH', { count: pending.length, reason: 'ready' }); } catch {}
        for (const k of pending) enqueueKey(k);
      }
      
      // Dev-only: check for layout shift after reset
      if (DEBUG_LAYOUT && beforeRect) {
        const afterRect = captureViewportRect(viewportEl);
        logLayoutShift(beforeRect, afterRect, 'resetFromPrompt');
      }
    });
  }, []);

  /* init & prop change */
  useEffect(() => {
    if (promptText(prompt).length > 0) {
      resetFromPrompt(prompt);
    }
  }, [prompt, resetFromPrompt]);

  /* util to compute per-word line mapping using unified layout */
  const computeWordLines = useCallback(() => {
    const measureWord = (wordIndex: number) => {
      const el = wordRefs.current[wordIndex];
      if (!el) return null;
      
      const rect = el.getBoundingClientRect();
      const containerRect = contentRef.current?.getBoundingClientRect();
      if (!containerRect) return null;
      
      return {
        left: rect.left - containerRect.left,
        top: el.offsetTop,
        lineHeight: lineHeightRef.current || LINE_H
      };
    };

    const newLayout = computeWordLineLayout(words, measureWord);
    setLineLayout(newLayout);
    
    // Keep legacy refs for compatibility
    wordLineRef.current = newLayout.wordIndexToLine;
    const ends: number[] = [];
    newLayout.wordIndexToLine.forEach((ln, idx) => { ends[ln] = idx; });
    lineEndsRef.current = ends;
  }, [words, LINE_H]);

  // Measure real line-height & word lines AFTER fonts load, then lock it.
  // This prevents the "jump" when typing starts.
  useEffect(() => {
    if (!words.length) return;
    let cancelled = false;

    const ready = (document as any).fonts?.ready ?? Promise.resolve();
    ready.then(() => {
      if (cancelled) return;

      // Try to read computed line-height from the first rendered word
      const firstEl = wordRefs.current.find(Boolean);
      if (firstEl) {
        const cs = getComputedStyle(firstEl);
        const lh = parseFloat(cs.lineHeight);
        if (!Number.isNaN(lh) && lh > 0) {
          lineHeightRef.current = Math.max(24, Math.round(lh));
        }
      }

      computeWordLines();
      setMeasured(true);
    });

    return () => { cancelled = true; };
  }, [words, runSeq, computeWordLines]);

  // when the words array (or a run token if you have one) changes,
  // clear the 'measured' gate so we re-measure and re-center correctly.
  useEffect(() => {
    setMeasured(false);
  }, [words]);

  // getCharacterStatus removed; rendering uses `evals` with persistent states

  /* Stats computations + live updates */
  const wpmSeries = useRef<{ time: number; wpm: number }[]>([]);

  const pushStats = useCallback(() => {
    if (!hasStarted || !startTime || isComplete) return;
    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    const tally = tallyWords(evals);
    const wpm = Math.round(officialWpm(tally.correct, elapsed * 1000));
    const acc = Math.round(accFn(tally.correct, tally.incorrect, 0, tally.extra));
    setCorrectChars(tally.correct);
    setTotalChars(tally.correct + tally.incorrect + tally.extra);
    wpmSeries.current.push({ time: elapsed, wpm });
    onStatsUpdate(wpm, acc, elapsed);
  }, [hasStarted, startTime, isComplete, evals, onStatsUpdate]);

  /* Timer effect for time mode */
  useEffect(() => {
    if (mode === 'time' && hasStarted && startTime && !isComplete) {
      const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - startTime) / 1000;
        setTime(elapsed);
        pushStats();
        if (elapsed >= durationSec) {
          const tally = tallyWords(evals);
          const finalWpm = Math.round(officialWpm(tally.correct, elapsed * 1000));
          const finalAcc = Math.round(accFn(tally.correct, tally.incorrect, 0, tally.extra));
          setIsComplete(true);
          onTestComplete(finalWpm, finalAcc, elapsed, (inputWords || []).join(' '));
          try { weakspot.commitRun(); } catch {}
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [hasStarted, startTime, isComplete, evals, mode, onTestComplete, inputWords, durationSec, pushStats]);

  useEffect(() => {
    if (!measured) return;
    const line = wordLineRef.current[currentWordIndex] ?? 0;
    const desiredTop = clampTop(line - CENTER_OFFSET);

    if (desiredTop !== visibleStartLine) {
      setVisibleStartLine(desiredTop);
      const el = contentRef.current;
      if (el) {
        // Use the measured line-height (set by the fonts-ready effect) so the
        // scroll step always matches what's actually rendered. Falls back to
        // LINE_H on the very first frame before measurement completes.
        const lh = lineHeightRef.current || LINE_H;
        const px = Math.round(desiredTop * lh * PROMPT_SCALE);
        requestAnimationFrame(() => { el.style.transform = `translateY(-${px}px)`; });
      }
    }
    lastLineRef.current = line;
  }, [measured, currentWordIndex, visibleStartLine, clampTop, runSeq, mode]);



  /* Debounced resize handler to keep layout fresh */
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (measured && words.length > 0) {
          computeWordLines();
        }
      }, 100);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, [measured, words.length, computeWordLines]);

  // Util to spawn embers at caret position
  function spawnAtCaret(n = 2) {
    const el = document.querySelector('[data-caret="on"]') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = rect.left + rect.width * 0.6 + window.scrollX;
    const py = rect.top + rect.height * 0.2 + window.scrollY;
    emberRef.current?.spawn(px, py, n);
  }

  // --- Smooth caret mover: uses rAF-based tween, instant snap on backspace ---
  const moveCaret = useCallback(() => {
    const wrap = promptWrapRef.current;
    const caret = caretRef.current;
    if (!wrap || !caret) return;

    const anchor = wrap.querySelector<HTMLElement>('[data-caret="on"]');
    if (!anchor) {
      try { caret.classList.add('bk-caret-hidden'); } catch {}
      return;
    }

    try { caret.classList.remove('bk-caret-hidden'); } catch {}
    
    // Use smooth motion system if initialized
    if (caretMoverRef.current) {
      caretMoverRef.current.toAnchor(anchor);
    }
    
    // mark as moving briefly to pause blink animation
    try {
      caret.classList.add('bk-caret-moving');
      if ((caretMoveTimer.current as any)) {
        window.clearTimeout(caretMoveTimer.current as any);
      }
      caretMoveTimer.current = window.setTimeout(() => {
        caret.classList.remove('bk-caret-moving');
      }, 110) as any;
    } catch {}
  }, []);

  // Initialize smooth caret mover
  useEffect(() => {
    const wrap = promptWrapRef.current;
    const caret = caretRef.current;
    if (!wrap || !caret) return;

    const { createCaretMover } = require("@/lib/caretMotion");
    
    // Map smoothCaret setting to duration
    const SMOOTH_MS: Record<string, number> = {
      off: 0,
      fast: 85,
      medium: 110,
      slow: 150,
    };
    
    const getCaretStyle = (): "bar" | "block" | "outline" | "underline" => {
      const style = useSettingsStore.getState().appearance.caret.style;
      return style as "bar" | "block" | "outline" | "underline";
    };
    
    const getSmoothMs = () => {
      const setting = useSettingsStore.getState().appearance.caret.smoothCaret || "medium";
      return SMOOTH_MS[setting] ?? 110;
    };

    caretMoverRef.current = createCaretMover({
      wrap,
      caret,
      getStyle: getCaretStyle,
      getSmoothMs,
    });

    return () => {
      caretMoverRef.current?.reset();
      caretMoverRef.current = null;
    };
  }, [runSeq]); // Re-init on test restart

  // Reposition caret on resize and on mount
  useEffect(() => {
    const onResize = () => moveCaret();
    moveCaret();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moveCaret]);

  // Focus the container when overlay is not open to ensure key flow
  useEffect(() => {
    if (!overlayOpen) {
      try { containerRef.current?.focus?.(); } catch {}
    }
  }, [overlayOpen]);

  // Reposition caret when indices/visibility change or after scroll transform updates
  useEffect(() => {
    requestAnimationFrame(moveCaret);
  }, [moveCaret, currentWordIndex, cursorCol, cursorVisible, visibleStartLine, measured, evals.length]);

  const finalizeWordsRun = useCallback(() => {
    if (isCompletedRef.current) return;
    isCompletedRef.current = true;
    const wevals: WordEval[] = words.map((w, i) => evalWord(w, inputWords[i] ?? ""));
    const tally = tallyWords(wevals);
    const elapsedSec = startTime ? (Date.now() - startTime) / 1000 : 0;
    const finalWpm = Math.round(officialWpm(tally.correct, elapsedSec * 1000));
    const finalAcc = Math.round(accFn(tally.correct, tally.incorrect, 0, tally.extra));
    setIsComplete(true);
    onTestComplete(finalWpm, finalAcc, elapsedSec, (inputWords || []).join(' '));
    try { weakspot.commitRun(); } catch {}
  }, [words, inputWords, startTime, onTestComplete]);

  // Helpers: printable detection for keydown fallback/guards
  const isPrintableKey = useCallback((e: KeyboardEvent) => (e.key.length === 1 && !e.ctrlKey && !e.metaKey), []);

  /* rAF-batched input handling */
  const applyBatch = useCallback((items: KeyEvent[]) => {
    if (!items.length) return;
    if (isCompletedRef.current) return;
    try { trace('BATCH_FLUSH', { count: items.length }); } catch {}
    // Normalize within the frame: apply letters before control keys (space/backspace)
    const keys = items.map(i => i.k);
    const normalized: string[] = [];
    let lettersBuf: string[] = [];
    const flushLetters = () => { if (lettersBuf.length) { normalized.push(...lettersBuf); lettersBuf = []; } };
    for (const k of keys) {
      if (k.length === 1 && k !== ' ') { // regular character (non-space)
        lettersBuf.push(k);
        continue;
      }
      // control key: flush letters first, then control
      flushLetters();
      normalized.push(k);
    }
    flushLetters();

    // local copies for single-commit, seeded from refs (fresh immediately after previous batch)
    let nextWords = inputWordsRef.current.slice();
    let wi = currentWordIndexRef.current;
    let col = cursorColRef.current;
    let finishedByTyping = false;
    let finishedBySpace = false;

    const commitInput = (idx: number, next: string) => { nextWords[idx] = next; };

    for (const k of normalized) {
      if (k === 'Backspace') {
        try { dbgLogRef.current.push({ ts: performance.now(), kind: 'backspace', wi, col }); } catch {}
        const curr = nextWords[wi] ?? "";
        if (col > 0 && curr.length > 0) {
          commitInput(wi, curr.slice(0, -1));
          col = Math.max(0, col - 1);
        } else if (wi > 0) {
          wi = wi - 1;
          const prevIn = nextWords[wi] ?? "";
          col = prevIn.length;
        }
        // advance anchor for flight timing (optional)
        lastDownAtRef.current = nowTs();
        try { trace('APPEND_CHAR', { ch: 'Backspace', status: hasStartedRef.current ? 'running' : 'pre', idx: wi, typedWord: nextWords[wi] ?? '' }); } catch {}
        continue;
      }

      // ── Space key: Monkeytype semantics ──────────────────────────────
      if (k === ' ') {
        try {
          dbgLogRef.current.push({
            ts: performance.now(),
            kind: 'space',
            wi,
            currLen: (nextWords[wi] ?? '').length,
            expectedLen: (words[wi] ?? '').length,
          });
        } catch {}
        // current word input and expected target
        const expected = words[wi] ?? "";
        const curr = nextWords[wi] ?? "";
        try { trace('EVAL', { reason: 'space', target: expected, typed: curr, idx: wi }); } catch {}

        // 1) If pressed at the very start (no first letter yet) → DO NOTHING
        //    (Don't advance, don't mark anything.)
        if (curr.length === 0) {
          continue; // ignore this space completely
        }

        // 2) If we typed ≥1 char but didn't finish the word → mark remainder incorrect
        //    We do this by padding the input up to expected.length with a sentinel
        //    char that never equals the expected, so evalWord marks them "incorrect".
        if (curr.length < expected.length) {
          const PAD = "\u0001"; // any char that won't match expected letters
          const padded = curr.padEnd(expected.length, PAD);
          commitInput(wi, padded);
        }

        // 3) Honor stopOnError: if enabled and this word contains mistakes or extras,
        //    block advancing. (Monkeytype's stop-on-error behavior.)
        const we = evalWord(expected, nextWords[wi] ?? "");
        const hasBlocking =
          stopOnError && (we.states.includes("incorrect") || we.states.includes("extra"));
        if (hasBlocking) {
          // do not advance; user must fix the word first
          continue;
        }

        // 4) Advance to next word
        if (wi >= words.length - 1) {
          if (mode === 'words') {
            // words mode can finish by space on last word
            finishedBySpace = true;
            wi = words.length;
            continue;
          } else {
            // time mode: ensure buffer exists, then advance
            void appendMoreWordsIfNeeded(wi);
          }
        }
        wi = Math.min(wi + 1, words.length - 1);
        col = (nextWords[wi] ?? "").length; // place caret at start-of-next (or after any existing input)
        spawnAtCaret(3);
        // advance anchor for flight timing (optional)
        lastDownAtRef.current = nowTs();
        lastCharRef.current = ' ';
        continue;
      }

      if (k.length === 1) {
        const ch = normalizeInputChar(k);
        const curr = nextWords[wi] ?? "";
        const colBefore = col;
        commitInput(wi, curr + ch);
        col = col + 1;
        try { trace('APPEND_CHAR', { ch, status: hasStartedRef.current ? 'running' : 'pre', idx: wi, typedWord: (curr + ch) }); } catch {}
        // If we’re on the last word and we've now typed at least expected length → finish
        const isLastWord = wi >= words.length - 1;
        if (isLastWord) {
          const expectedLast = words[words.length - 1] ?? "";
          const inputLast = nextWords[words.length - 1] ?? "";
          if (inputLast.length >= expectedLast.length) {
            finishedByTyping = true;
          }
        }
        // check if this char is correct and spawn embers
        const we = evalWord(words[wi] ?? "", curr + ch);
        const st = we.states[colBefore];
        try { trace('EVAL', { reason: 'char', target: words[wi] ?? '', typed: curr + ch, idx: wi }); } catch {}
        try {
          dbgLogRef.current.push({
            ts: performance.now(),
            kind: 'char',
            wi,
            ci: colBefore,
            expected: (words[wi] ?? '')[colBefore] ?? null,
            typed: ch,
            verdict: st,
          });
        } catch {}
        // AI Coach: per-keystroke observation (no behavior change)
        try {
          const ts = nowTs();
          weakspot.noteKeystroke({
            char: ch,
            correct: st === "correct",
            tsDown: ts,
            tsPrevDown: lastDownAtRef.current ?? undefined,
            prevChar: lastCharRef.current ?? undefined,
          });
          lastDownAtRef.current = ts;
          lastCharRef.current = ch;
        } catch {}
        if (st === "correct") {
          spawnAtCaret(2);
        }
        continue;
      }
    }

    // Single commit of state (+ keep refs in sync immediately for the next rAF batch)
    inputWordsRef.current = nextWords;
    currentWordIndexRef.current = wi;
    cursorColRef.current = col;
    setInputWords(nextWords);
    setCurrentWordIndex(wi);
    setCursorCol(col);

    if (mode === 'time') {
      // keep a healthy suffix of words available
      void appendMoreWordsIfNeeded(wi);
    }

    // Words-mode: finalize immediately if we just finished by typing or space on last word
    if (mode === 'words' && (finishedByTyping || finishedBySpace)) {
      finalizeWordsRun();
      return; // ensure we don't push further state this frame
    }

    // compute metrics once per frame
    if (hasStartedRef.current && startTime && !isComplete) {
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;
      const wevals: WordEval[] = words.map((w, i) => evalWord(w, nextWords[i] ?? ""));
      const tally = tallyWords(wevals);
      const wpm = Math.round(officialWpm(tally.correct, elapsed * 1000));
      const acc = Math.round(accFn(tally.correct, tally.incorrect, 0, tally.extra));
      setCorrectChars(tally.correct);
      setTotalChars(tally.correct + tally.incorrect + tally.extra);
      wpmSeries.current.push({ time: elapsed, wpm });
      onStatsUpdate(wpm, acc, elapsed);

      // Optional party-mode emission. Fire-and-forget, fully gated, no
      // network awaits. When `partyRef.current` is undefined (solo mode),
      // this block is a single null check — zero added work.
      const partyHook = partyRef.current;
      if (partyHook?.onProgress) {
        // Canonical cursor position in the *expected* prompt text. The
        // expected stream uses `words.join(' ')`, so each prior word
        // contributes its length + 1 space. Clamp the in-word offset to
        // the word length so over-typed extras don't push charIndex past
        // the word boundary.
        let priorLen = 0;
        for (let i = 0; i < wi; i++) priorLen += (words[i]?.length ?? 0) + 1;
        const inWord = Math.min(col, words[wi]?.length ?? 0);
        const charIndex = priorLen + inWord;
        try {
          partyHook.onProgress({
            charIndex,
            correctChars: tally.correct,
            incorrectChars: tally.incorrect + tally.extra,
            wpm,
            accuracy: acc,
            elapsedMs: Math.round(elapsed * 1000),
          });
        } catch {
          // Defense in depth: typing must never break because of a party hook.
        }
      }
    }

    // words-mode completion when advancing from last word
    if (mode === 'words' && !isComplete) {
      if (wi >= words.length) {
        const end = Date.now();
        const elapsed = startTime ? (end - startTime) / 1000 : 0;
        const wevals: WordEval[] = words.map((w, i) => evalWord(w, nextWords[i] ?? ""));
        const tally = tallyWords(wevals);
        const finalWpm = Math.round(officialWpm(tally.correct, elapsed * 1000));
        const finalAcc = Math.round(accFn(tally.correct, tally.incorrect, 0, tally.extra));
        setIsComplete(true);
        onTestComplete(finalWpm, finalAcc, elapsed, nextWords.join(' '));
      }
    }
  }, [
    /* remove rapidly-changing state deps that seed batch baselines: */
    startTime, isComplete, words, mode,
    onStatsUpdate, onTestComplete, stopOnError, finalizeWordsRun
  ]);

  const enqueueKey = useMemo(() => {
    const q = createRafQueue<KeyEvent>(
      (items) => applyBatch(items),
      { sort: (a, b) => ((a.__ts ?? 0) - (b.__ts ?? 0)) }
    );
    return (k: string) => q({ k, __ts: (typeof performance !== 'undefined' ? performance.now() : Date.now()) });
  }, [applyBatch]);

  // BEFOREINPUT: single-source for printable characters (including space) and IME composition text
  const handleBeforeInput = useCallback((e: InputEvent) => {
    if (isCompletedRef.current) return;
    if ((e as any).isComposing) return; // compositionend will deliver the final text
    const t = (e as any).inputType as string | undefined;
    if (t === "insertText" || t === "insertCompositionText") {
      try { trace('KEY', { type: 'beforeinput', key: (e as any).data ?? '', inputType: t, status: hasStarted ? 'running' : 'pre', idx: currentWordIndex, typedWord: inputWords[currentWordIndex] ?? '' }); } catch {}
      // Ensure run starts on first printable input
      if (!hasStarted) {
        try { trace('START_TEST_CALLED', { callsite: 'beforeinput', statusBefore: hasStarted ? 'running' : 'pre' }); } catch {}
        setHasStarted(true);
        setStartTime(Date.now());
        try { trace('STATUS_RUNNING', { startedAt: Date.now() }); } catch {}
        if (focusEnabled && !overlayOpen) { try { setFocus(true); } catch {} }
        if (mode === 'time') endAtRef.current = Date.now() + durationSec * 1000;
      }
      const data = (e as any).data ?? "";
      const ch = normalizeInputChar(String(data));
      if (!ch) { try { e.preventDefault(); } catch {} ; return; }
      try { e.preventDefault(); } catch {}
      if (!readyRef.current) { bufferRef.current.push(ch); return; }
      enqueueKey(ch);
    }
  }, [enqueueKey, hasStarted, focusEnabled, overlayOpen, mode, durationSec]);

  // IME: commit composed text
  const handleCompositionEnd = useCallback((e: CompositionEvent) => {
    const text = (e as any).data ?? "";
    try { trace('KEY', { type: 'compositionend', text, status: hasStarted ? 'running' : 'pre', idx: currentWordIndex, typedWord: inputWords[currentWordIndex] ?? '' }); } catch {}
    if (!text) return;
    // Ensure run starts if composition commits before keydown path
    if (!hasStarted) {
      try { trace('START_TEST_CALLED', { callsite: 'compositionend', statusBefore: hasStarted ? 'running' : 'pre' }); } catch {}
      setHasStarted(true);
      setStartTime(Date.now());
      try { trace('STATUS_RUNNING', { startedAt: Date.now() }); } catch {}
      if (focusEnabled && !overlayOpen) { try { setFocus(true); } catch {} }
      if (mode === 'time') endAtRef.current = Date.now() + durationSec * 1000;
    }
    const segs = Array.from(text);
    for (const raw of segs) enqueueKey(normalizeInputChar(raw));
  }, [enqueueKey, hasStarted, focusEnabled, overlayOpen, mode, durationSec]);

  // Attach beforeinput/composition listeners (capture) to receive even without focused inputs
  // COMMENTED OUT: beforeinput is not firing on this page, so we handle printable chars in keydown
  /*
  useEffect(() => {
    try { window.addEventListener('beforeinput', handleBeforeInput as any, { capture: true } as AddEventListenerOptions); } catch { window.addEventListener('beforeinput', handleBeforeInput as any); }
    try { window.addEventListener('compositionend', handleCompositionEnd as any, { capture: true } as AddEventListenerOptions); } catch { window.addEventListener('compositionend', handleCompositionEnd as any); }
    return () => {
      try { window.removeEventListener('beforeinput', handleBeforeInput as any, { capture: true } as AddEventListenerOptions); } catch { window.removeEventListener('beforeinput', handleBeforeInput as any); }
      try { window.removeEventListener('compositionend', handleCompositionEnd as any, { capture: true } as AddEventListenerOptions); } catch { window.removeEventListener('compositionend', handleCompositionEnd as any); }
    };
  }, [handleBeforeInput, handleCompositionEnd]);
  */

  /* ───────── Keyboard handler ───────── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      try {
        trace('KEY', {
          type: 'down',
          key: (e as any).key,
          code: (e as any).code,
          status: hasStarted ? 'running' : 'pre',
          idx: currentWordIndex,
          typedWord: inputWords[currentWordIndex] ?? ''
        });
      } catch {}
      // ignore IME composition and OS key-repeat for character/control keys
      if ((e as any).isComposing) return;
      if (e.repeat && (e.key.length === 1 || e.key === ' ' || e.key === 'Backspace')) return;
      
      // Start the run on first visible key BEFORE any guards
      if (!hasStarted && e.key.length === 1) {
        try { tl('first key', { key: e.key, runId: 'n/a' }); } catch {}
        try { devLog('first keydown', e.key); } catch {}
        try { trace('START_TEST_CALLED', { callsite: 'keydown', statusBefore: 'pre' }); } catch {}
        setHasStarted(true);
        setStartTime(Date.now());
        try { trace('STATUS_RUNNING', { startedAt: Date.now() }); } catch {}
        // Enter focus mode if enabled and no overlay is open
        if (focusEnabled && !overlayOpen) { try { setFocus(true); } catch {} }
        if (mode === 'time') {
          endAtRef.current = Date.now() + durationSec * 1000;
        }
      }

      // If we aren't ready or still (externally) loading, BUFFER printable/backspace/space.
      const isPrintableOrControl = (e.key.length === 1 || e.key === ' ' || e.key === 'Backspace');
      if (externalLoading || isLoading || !readyRef.current) {
        if (isPrintableOrControl) {
          const token = (e.key === 'Backspace') ? 'Backspace' : normalizeInputChar(e.key);
          if (token) bufferRef.current.push(token);
          if (e.key === ' ') e.preventDefault(); // avoid page scroll while buffering space
          try { trace('KEY_BUFFERED', { key: e.key, token, reason: externalLoading ? 'externalLoading' : (!readyRef.current ? 'notReady' : 'isLoading') }); } catch {}
        }
        return; // swallow until ready; we'll flush in rAF
      }

      // Allow ESC to exit focus (do not prevent default; let modals handle too)
      if (e.key === 'Escape') {
        if (!overlayOpen) { try { setFocus(false); } catch {} }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-click-only]")) {
        return;
      }

      if (isComplete) return;

      /* restart combo handling */
      if (e.key === 'Tab') {
        e.preventDefault();
        isTabHeldRef.current = true;
        lastTabDownAtRef.current = Date.now();
        return;
      }
      if (e.key === 'Enter') {
        const recentTab = lastTabDownAtRef.current && (Date.now() - lastTabDownAtRef.current <= 500);
        if (isTabHeldRef.current || recentTab) {
          e.preventDefault();
          try { tl('TypingBox TabEnter restart'); } catch {}
          if (onRequestNewPrompt) {
            void onRequestNewPrompt();
          } else if (prompt) {
            resetFromPrompt(prompt);
          }
          return;
        }
      }

      /* backspace */
      if (e.key === 'Backspace') {
        e.preventDefault();
        enqueueKey('Backspace');
        return;
      }

      // Printable characters (including space) → process here instead of relying on beforeinput
      if (e.key.length === 1 || e.key === ' ') {
        const ch = normalizeInputChar(e.key);
        if (!ch) return;
        // do not rely on beforeinput; enqueue directly
        enqueueKey(ch);
        // we generally don't need preventDefault since nothing is focused,
        // but prevent scroll on Space just in case:
        if (e.key === ' ') e.preventDefault();
        return;
      }
    },
    [
      externalLoading,
      isLoading,
      isComplete,
      hasStarted,
      startTime,
      mode,
      durationSec,
      words,
      currentWordIndex,
      onStatsUpdate,
      onTestComplete,
      debug,
      debugPaused,
      visibleStartLine,
      clampTop,
      targetStream,
      pushStats,
      resetFromPrompt,
      onRequestNewPrompt,
      prompt,
      enqueueKey,
      isPrintableKey,
      focusEnabled,
      overlayOpen,
      setFocus
    ]
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      isTabHeldRef.current = false;
    }
  }, []);

  /* attach listener */
  useEffect(() => {
    try { document.body.classList.add("bk-typing-active"); } catch {}
    try { window.addEventListener('keydown', handleKeyDown as any, { capture: true } as AddEventListenerOptions); } catch { window.addEventListener('keydown', handleKeyDown as any); }
    try { window.addEventListener('keyup', handleKeyUp as any, { capture: true } as AddEventListenerOptions); } catch { window.addEventListener('keyup', handleKeyUp as any); }
    return () => {
      try { window.removeEventListener('keydown', handleKeyDown as any, { capture: true } as AddEventListenerOptions); } catch { window.removeEventListener('keydown', handleKeyDown as any); }
      try { window.removeEventListener('keyup', handleKeyUp as any, { capture: true } as AddEventListenerOptions); } catch { window.removeEventListener('keyup', handleKeyUp as any); }
      try { document.body.classList.remove("bk-typing-active"); } catch {}
      try { setFocus(false); } catch {}
    };
  }, [handleKeyDown, handleKeyUp]);

  // Optional: exit focus on first mouse move during an active run
  useEffect(() => {
    if (!focusEnabled || !exitOnMouseMove) return;
    if (!hasStarted || isComplete) return;
    if (!isFocus) return;
    const onMove = () => { try { setFocus(false); } catch {} ; window.removeEventListener('mousemove', onMove as any); };
    try { window.addEventListener('mousemove', onMove as any, { once: true, passive: true } as AddEventListenerOptions); } catch { window.addEventListener('mousemove', onMove as any); }
    return () => { try { window.removeEventListener('mousemove', onMove as any); } catch {} };
  }, [focusEnabled, exitOnMouseMove, hasStarted, isComplete, isFocus, setFocus]);

  // Use CSS-only blink to avoid extra renders
  useEffect(() => { setCursorVisible(true); }, []);

  if (externalLoading || isLoading) {
    // Use same container class for consistent positioning even during loading
    return (
      <div className="bk-typing-container mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-300"></div>
        </div>
      </div>
    );
  }

  // Viewport height expressed via the same font clamp the content uses, so the
  // 3-line window always frames exactly three lines regardless of viewport size.
  // The +0.25rem is breathing room at the bottom of the visible window.
  const VIEWPORT_HEIGHT_CSS = `calc(${TOTAL_LINES} * ${LINE_RATIO} * ${PROMPT_FONT_SIZE} + 0.25rem)`;

  // CRITICAL: Fixed positioning for typing text.
  // 13.75rem = 220px at root=16px (laptop baseline). Tracks --bk-ui-scale tiers.
  const TYPING_TOP_OFFSET_REM = 13.75;

  return (
    <div
      ref={containerRef}
      className="bk-typing-container mx-auto max-w-[92rem] px-4 sm:px-6 outline-none"
      tabIndex={-1}
      style={{
        minHeight: "100svh",
        contain: "layout style paint",
        boxSizing: "border-box",
        // Inline styles for maximum specificity - cannot be overridden
        paddingTop: `${TYPING_TOP_OFFSET_REM}rem`,
        paddingBottom: "5rem",
        marginTop: 0,
      }}
    >

      {/* Fixed 3-line window with consistent height (em-based so it tracks font-size) */}
      <div
        data-bk-viewport
        className="rounded-xl select-none"
        style={{
          height: VIEWPORT_HEIGHT_CSS,
          // Match content font-size so child em/line calcs resolve identically
          fontSize: PROMPT_FONT_SIZE,
          overscrollBehavior: scrollLocked ? "none" : "auto",
          // Use overflow-y hidden but allow text to be fully visible horizontally
          overflowY: "hidden",
          overflowX: "visible",
        }}
        onWheelCapture={scrollLocked ? (e) => e.preventDefault() : undefined}
        onTouchMoveCapture={scrollLocked ? (e) => e.preventDefault() : undefined}
      >
        <div
          ref={contentRef}
          data-bk-content
          className="relative transition-transform duration-200 ease-out"
          style={{
            lineHeight: LINE_RATIO, // unitless — scales with font-size for consistent rhythm
            fontSize: PROMPT_FONT_SIZE,
            fontFamily:
              'JetBrains Mono, Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
            paddingBottom: `${SAFE_BOTTOM_REM}rem`,
            willChange: scrollLocked ? "transform" : "auto",
            ["--bk-prompt-scale" as any]: PROMPT_SCALE,
          }}
        >
          {/* Width constraint wrapper — rem-based so it tracks --bk-ui-scale tiers
              and viewport-percentage clamped so it stays proportional on every screen.
              At scale 1.0 (laptop): 85rem ≈ 1360px. At scale 1.12 (1080p): ≈ 1521px.
              At scale 1.25 (1440p+): ≈ 1700px. The 92vw cap keeps mobile/narrow
              widths from hitting the rem ceiling and gives sensible margins. */}
          <div 
            className="mx-auto"
            style={{
              maxWidth: "min(85rem, 92vw)",
              width: "100%",
            }}
          >
          <div className="bk-prompt-scale-wrap">
            <div
              ref={promptWrapRef}
              data-testid="prompt-root"
              className="px-2 leading-relaxed bk-prompt-scale bk-prompt-rel"
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                whiteSpace: "pre-wrap", // Allow wrapping while preserving spaces
                wordBreak: "normal", // Don't break words in middle
              }}
            >
            {/* Overlay caret */}
            <div 
              ref={caretRef} 
              className={clsx(
                "bk-caret-bar bk-caret-hidden",
                useSettingsStore.getState().appearance.caret.style
              )} 
              aria-hidden="true" 
            />
            {evals.map((we, wi) => {
              const active = wi === currentWordIndex;
              const expected = we.expected;
              // Before any typing, force renderer to treat input as empty
              const typed = (inputWords?.some(w => (w?.length ?? 0) > 0)) ? (inputWords[wi] ?? "") : "";
              const L = Math.max(expected.length, typed.length);
              const caretCol = (inputWords?.some(w => (w?.length ?? 0) > 0)) ? cursorCol : 0;

              return (
                <React.Fragment key={wi}>
                  <span
                    ref={(el) => { wordRefs.current[wi] = el; }}
                    className="inline-block bk-word"
                    data-active={active ? "1" : undefined}
                  >
                    {Array.from({ length: L }).map((_, ci) => {
                      // Decide what to render and what state to paint
                      let showChar: string;
                      let st: "untyped" | "correct" | "incorrect" | "extra" | "cursor";

                      if (ci < expected.length) {
                        // Always render the EXPECTED character for the main word body
                        showChar = expected[ci] ?? "";
                        if (ci < typed.length) {
                          st = typed[ci] === expected[ci] ? "correct" : "incorrect";
                        } else {
                          st = "untyped";
                        }
                      } else {
                        // Beyond expected length → extras: render the TYPED character
                        showChar = typed[ci] ?? "";
                        st = "extra";
                      }

                      // Cursor overlay on active word: only attach to in-body character
                      if (active && ci === caretCol && caretCol < expected.length) st = "cursor";

                      return (
                        <span
                          key={`${wi}-${ci}`}
                          data-caret={st === "cursor" ? (cursorVisible ? "on" : "off") : undefined}
                          data-status={st}
                          // Ghost cursor anchor: only in party mode and only for
                          // in-body characters (not extra-typed ones). The attribute
                          // maps to the global position in words.join(' ') so the
                          // GhostCursor component can querySelector by charIndex.
                          // Absent in solo mode — zero DOM overhead.
                          data-bk-ci={
                            wordStartIndices && ci < expected.length
                              ? wordStartIndices[wi] + ci
                              : undefined
                          }
                          className={clsx(
                            "relative transition-all duration-100 ease-out bk-char",
                            st === "correct" && "text-gray-200",
                            st === "incorrect" && "text-red-400",
                            st === "extra" && "text-orange-300/90 underline decoration-dotted",
                            st === "untyped" && "text-gray-600",
                            // Cursor letter should appear untyped (not bright)
                            st === "cursor" && "text-gray-600"
                          )}
                        >
                          {showChar}
                        </span>
                      );
                    })}
                  </span>
                  {/* End-of-word caret anchor: when caret is at/after last expected char */}
                  {active && caretCol >= expected.length && (
                    <span key={`${wi}-end-caret`} aria-hidden="true" className="bk-caret-slot" data-caret="on" />
                  )}
                  {wi < evals.length - 1 ? " " : null}
                </React.Fragment>
              );
            })}
            </div>
          </div>
          </div>{/* end width constraint wrapper */}
        </div>
      </div>

      {debug && (
        <div className="mt-4 text-xs text-gray-500">
          Debug: {currentWordIndex}:{cursorCol} | chars: {correctChars}/{totalChars} | line: {wordLineRef.current[currentWordIndex] ?? 0} | visible: {visibleStartLine}-{visibleStartLine + TOTAL_LINES - 1}
          {debugLog.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto bg-gray-900 p-2 rounded text-xs">
              {debugLog.slice(-10).map((entry, i) => (
                <div key={i} className="text-gray-400">
                  [{entry.ts}] {entry.event} @ {entry.wi}:{entry.ci} target="{entry.target}" typed="{entry.typed}" {entry.note}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TypingBox;