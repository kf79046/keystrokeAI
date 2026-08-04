// src/components/typing/ResultsPanel.tsx
"use client";

import * as React from "react";
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import dynamic from "next/dynamic";
const AIFeedbackCardRevamp = dynamic(() => import("@/components/feedback/AIFeedbackCardRevamp"), {
  ssr: false,
  loading: () => <div className="p-5 rounded-xl border border-white/10 bg-white/5 animate-pulse h-[180px]" />
});
import FireSummaryCard from "@/components/test/FireSummaryCard";
import CommandHintsFloating from "@/components/ui/CommandHintsFloating";
import { useCommandsStore, type CommandAction } from "@/stores/commands";
import { useStatsStore } from "@/stores/useStatsStore";
import ResultsStatsBar from "./ResultsStatsBar";
import AICoachCard from "@/components/ai/AICoachCard";
import ResultsChart from "./ResultsChart";
import { safeCopy } from "@/utils/safeCopy";
import { Switch } from "@/components/ui/switch";
import * as Tooltip from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { useHydrated } from "@/lib/useHydrated";
import { mark } from "@/lib/perf";
import { stdev } from "@/lib/statsMath";
import { getTrendRevealProps, prepareResultsSeries } from "@/lib/resultsSeries";
import AdSlot from "@/components/ads/AdSlot";

export interface ResultsPanelProps {
  wpm: number;
  accuracy: number;
  time: number;
  analysis: {
    input: string;
    corrections: string[];
    difficulty: string;
    feedback: string;
  } | null;
  wpmSeries?: Array<{ second: number; wpm: number }>;
  onNextTest?: () => void | Promise<void>;
  onPracticeWeakSpots?: () => void;
  onPracticeWeakSpotsTimed?: () => void; // NEW
  usedDifficulty?: "easy" | "medium" | "hard";
  avgWpm?: number;
  avgAcc?: number;
  flags?: { punctuation?: boolean; numbers?: boolean };
  usedConfig?: {
    mode: "words" | "time" | "quote" | "zen" | "custom";
    wordCount?: number | null;
    durationSec?: number | null;
    include_punctuation?: boolean;
    include_numbers?: boolean;
    language?: string | null;
  };

}

export default function ResultsPanel(props: ResultsPanelProps) {
  const { registerGroup, setActiveGroup } = useCommandsStore();

  const isHydrated = useHydrated();
  const blazeEnabled = useSettingsStore(s => s.test.blazeModeEnabled);

  const copyResults = React.useCallback(async () => {
    const text = `WPM: ${Math.round(Number(props.wpm ?? 0))}, Acc: ${Math.round(Number(props.accuracy ?? 0))}% — Time: ${Math.round(Number(props.time ?? 0))}s`;
    try { await safeCopy(text); } catch {}
  }, [props.wpm, props.accuracy, props.time]);

  React.useEffect(() => {
    const actions: CommandAction[] = [
      { id: "restart", label: "Restart test", kbd: "Tab+Enter", run: () => { try { props.onNextTest?.(); } catch {} } },
      { id: "copy",    label: "Copy results", kbd: "C",           run: copyResults },
      ...(props.onPracticeWeakSpots ? [{ id: "coach30", label: "Practice weak spots (30 words)", run: () => { try { props.onPracticeWeakSpots?.(); } catch {} } }] as CommandAction[] : []),
      ...(props.onPracticeWeakSpotsTimed ? [{ id: "coach30s", label: "Practice weak spots (30 sec)", run: () => { try { props.onPracticeWeakSpotsTimed?.(); } catch {} } }] as CommandAction[] : []),
    ];
    registerGroup("postTest", actions);
    setActiveGroup("postTest");
  }, [registerGroup, setActiveGroup, copyResults, props.onNextTest, props.onPracticeWeakSpots, props.onPracticeWeakSpotsTimed]);
  React.useEffect(() => { mark('results:mount'); }, []);
  const {
    accuracy,
    analysis,
    wpmSeries = [],
    onNextTest,
    onPracticeWeakSpots,
    onPracticeWeakSpotsTimed,
    usedDifficulty,
    avgWpm,
    avgAcc,
    flags,
  } = props;

  const chartData = React.useMemo(
    () => prepareResultsSeries(wpmSeries, props.time, props.wpm).map((point) => ({
      second: point.second,
      wpm: Math.round(point.wpm),
    })),
    [wpmSeries, props.time, props.wpm],
  );
  const wpmTrend = React.useMemo(() => chartData.map((point) => point.wpm), [chartData]);
  const coachWpm = wpmTrend.length ? wpmTrend[wpmTrend.length - 1] : props.wpm;
  const consistency = wpmTrend.length ? Math.max(0, 100 - stdev(wpmTrend)) : 0;
  const prefersReducedMotion = useReducedMotion();
  const trendReveal = getTrendRevealProps(!!prefersReducedMotion);
  const handleChartFirstPaint = React.useCallback(() => mark('chart:rendered'), []);
  const [nonCriticalReady, setNonCriticalReady] = React.useState(false);
  React.useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setNonCriticalReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  React.useEffect(() => {
    let tabHeld = false;
    let lastTabAt = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        // Keep focus in place on results; record Tab for combo detection
        tabHeld = true;
        lastTabAt = Date.now();
        try { e.preventDefault(); } catch {}
        return;
      }

      if (e.key === "Enter") {
        // Fire on bare Enter OR Tab+Enter pressed within a short window
        const withinWindow = Date.now() - lastTabAt <= 650;
        const allow = tabHeld ? withinWindow : true; // bare Enter allowed; Tab+Enter must be timely
        if (allow) {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch {}
          onNextTest?.();
          tabHeld = false;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Tab") tabHeld = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onNextTest]);
  // Normalize WPM values to 0..100 for sparkline animation
  const trendPercentages: number[] | undefined = (() => {
    if (!wpmTrend || wpmTrend.length < 2) return undefined;
    const min = Math.min(...wpmTrend);
    const max = Math.max(...wpmTrend);
    const range = Math.max(1, max - min);
    return wpmTrend.map((v) => Math.round(((v - min) / range) * 100));
  })();
  const nextKnobs: string[] | undefined = (() => {
    if (!flags) return undefined;
    const parts: string[] = [];
    parts.push(flags.punctuation === false ? "Punctuation off" : "Punctuation on");
    parts.push(flags.numbers === false ? "Numbers off" : "Numbers on");
    return parts;
  })();
  const aiError: string | null = (() => {
    const msg = analysis?.feedback || "";
    return msg.includes("Could not fetch AI feedback.") ? msg : null;
  })();
  // Compact chart context shown in the card header.
  const chartAvgWpm = chartData.length ? chartData.reduce((s, p) => s + p.wpm, 0) / chartData.length : undefined;
  const peakPoint = chartData.length
    ? chartData.reduce(
        (acc, p) => (p.wpm > acc.wpm ? p : acc),
        { second: 0, wpm: -Infinity as number }
      )
    : { second: 0, wpm: -Infinity as number };
  const hasPeak = Number.isFinite(peakPoint.wpm);

  // Derive error tokens source from most recent run in history when available
  const historyAll = useStatsStore(s => s.history);
  const lastRun = useMemo(() => (Array.isArray(historyAll) && historyAll.length ? historyAll[historyAll.length - 1] : null), [historyAll]);
  const errorEvents = useMemo(() => {
    const raw = (lastRun as any)?.events ?? (lastRun as any)?.keystrokes ?? (lastRun as any)?.keyLog ?? (lastRun as any)?.keyEvents ?? [];
    return Array.isArray(raw)
      ? raw.map((e: any, i: number) => ({
          key: e?.key ?? e?.char ?? e?.k ?? "",
          isError: !!(e?.isError ?? e?.error ?? e?.mistake),
          prevKey: e?.prevKey ?? e?.prev ?? (i > 0 ? (raw[i - 1]?.key ?? raw[i - 1]?.char ?? null) : null),
        }))
      : [];
  }, [lastRun]);
  const errorFallback = useMemo(() => {
    const bigrams = (lastRun as any)?.errorBigrams ?? null;
    const keys = (lastRun as any)?.mistypedKeys ?? (lastRun as any)?.errors ?? null;
    return bigrams || keys ? { bigrams, keys } : null;
  }, [lastRun]);

  return (
    <section className="relative z-[1] w-full mx-auto max-w-7xl px-4 md:px-6 bk-page-content results-scroll-root" aria-label="Results">

      <div className="grid grid-cols-12 gap-3 lg:gap-4 auto-rows-auto">
        {/* Top row: Blaze toggle + simple label */}
        <div className="col-span-12 -mb-2 flex items-center justify-between">
          {/* Keep element to preserve spacing; hide visually only */}
          <div className="invisible select-none text-sm font-medium opacity-80" aria-hidden="true">Results</div>
          {isHydrated && (
            <Tooltip.TooltipProvider delayDuration={150}>
              <Tooltip.Tooltip>
                <Tooltip.TooltipTrigger asChild>
                  <div className="flex items-center gap-2 bg-gray-800/30 backdrop-blur-sm border border-gray-700/30 rounded-xl px-3 py-2">
                    <span className="text-xs uppercase tracking-wider text-gray-400">Blaze mode (AI)</span>
                    <Switch
                      checked={blazeEnabled}
                      onCheckedChange={(v) => {
                        useSettingsStore.getState().update("test", { blazeModeEnabled: !!v });
                        props.onNextTest?.(); // immediately regenerate with new mode
                      }}
                    />
                  </div>
                </Tooltip.TooltipTrigger>
                <Tooltip.TooltipContent>AI adapts your next test using your recent results.</Tooltip.TooltipContent>
              </Tooltip.Tooltip>
            </Tooltip.TooltipProvider>
          )}
        </div>
        {/* Top banner: Blaze stats full width */}
        {usedDifficulty && (
          <div className="col-span-12">
            {(() => {
              const resolvedLastRunConfig = props.usedConfig
                ? {
                    mode: props.usedConfig.mode,
                    wordCount: props.usedConfig.wordCount ?? null,
                    durationSec: props.usedConfig.durationSec ?? null,
                    language: props.usedConfig.language ?? 'english',
                    punctuation: !!props.usedConfig.include_punctuation,
                    numbers: !!props.usedConfig.include_numbers,
                  }
                : undefined;
              return (
                <FireSummaryCard
                  difficulty={usedDifficulty}
                  averageWPM={Math.round(Number(avgWpm ?? 0))}
                  accuracy={Math.round(Number(avgAcc ?? 0))}
                  knobs={nextKnobs ?? ["Punctuation off", "Numbers off"]}
                  trend={trendPercentages}
                  error={aiError}
                  className="self-start"
                  lastRunConfig={resolvedLastRunConfig}
                  headerSlot={null}
                  secondarySize="sm"
                  prepend={
                    <ResultsStatsBar
                      wpm={Number(props.wpm ?? 0)}
                      accuracy={Number(props.accuracy ?? 0)}
                      durationSec={Number(props.time ?? 0)}
                      consistency={Math.round(consistency)}
                      coachWpm={Math.round(coachWpm)}
                      difficultyLabel={undefined}
                      showBadge={false}
                      variant="compact"
                      size="lg"
                      equalWidth
                      bare
                      errorEvents={errorEvents}
                      errorFallback={errorFallback}
                    />
                  }
                />
              );
            })()}
          </div>
        )}

        {/* Ad: Results (below top summary) */}
        {nonCriticalReady &&
          process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULTS &&
          process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID && (
          <div className="bk-results-ad-row col-span-12">
            <AdSlot
              slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULTS}
              pageKey="results"
            />
          </div>
        )}

        {/* Middle row: Insights left, Coach right */}
        <div className="col-span-12 lg:col-span-6">
          <div className="h-full">
            <AIFeedbackCardRevamp
              wpmTrend={wpmTrend}
              accuracyPct={accuracy}
              completed={true}
              runSnapshot={props.usedConfig ?? null}
              onNextTest={onNextTest}
              onPracticeWeakSpots={onPracticeWeakSpots}
              onPracticeWeakSpotsTimed={onPracticeWeakSpotsTimed}
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-6">
          {(onPracticeWeakSpots || onPracticeWeakSpotsTimed) && (
            <div className="h-full">
              <AICoachCard
                onPractice={onPracticeWeakSpots ?? (() => {})}
                onPracticeTimed={onPracticeWeakSpotsTimed}
              />
            </div>
          )}
        </div>

        {/* Bottom: Trend full-width */}
        <div className="col-span-12">
          <Card className="bk-fire-card bk-trend-card relative isolate overflow-hidden rounded-2xl h-full min-h-[432px]">
            <div aria-hidden className="bk-card-vignette bk-trend-card-vignette pointer-events-none absolute inset-0" />
            <CardHeader className="px-5 pt-5 pb-2 md:px-6 relative z-10">
              <div className="bk-chart-title mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-300/55">Performance</div>
                  <CardTitle className="text-base md:text-lg font-semibold bk-title bk-title--glow">Typing Speed Trend</CardTitle>
                </div>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/55">
                  {chartAvgWpm != null && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                      Avg <strong className="ml-1 font-semibold text-orange-200">{Math.round(chartAvgWpm)}</strong>
                    </span>
                  )}
                  {hasPeak && (
                    <span className="rounded-full border border-orange-400/15 bg-orange-400/[0.06] px-2.5 py-1">
                      Peak <strong className="ml-1 font-semibold text-orange-200">{Math.round(peakPoint.wpm)}</strong>
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-4 md:px-5 md:pb-5 relative z-10">
              <motion.div
                className="bk-trend-plot-shell h-[312px] md:h-[360px] p-1.5 md:p-2"
                {...trendReveal}
                data-testid="results-trend"
              >
                <ResultsChart
                  chartData={chartData}
                  reducedMotion={!!prefersReducedMotion}
                  onFirstPaint={handleChartFirstPaint}
                />
              </motion.div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right-side commands (visible only on results screen) */}
      <CommandHintsFloating context="results" />
    </section>
  );
}

