"use client";

import { weakspot } from "@/ai/weakspot";
import LogoMark from "@/components/brand/LogoMark";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Info, Target } from "lucide-react";

function CoachBadge() {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span
        className="absolute inset-0 rounded-full blur-md opacity-40"
        style={{ background: "radial-gradient(circle, rgba(255,200,0,.6) 0%, rgba(255,120,0,.2) 60%, transparent 70%)" }}
        aria-hidden
      />
      <Target className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">Practice weak spots</span>
    </span>
  );
}

export function AICoachCard({
  onPractice,
  onPracticeTimed,
  state = "ready",
  // Accept extra props if callers pass them; we ignore for UI-only changes
  deltas,
}: {
  onPractice: () => void;
  onPracticeTimed?: () => void;
  state?: "empty" | "ready" | "post" | "retestDue";
  deltas?: any;
}) {
  const { letters, digraphs } = weakspot.useTopWeak(3, 2);
  const enabled = weakspot.useEnabled();
  const hasEvidence = (letters.length + digraphs.length) > 0;

  return (
    <TooltipProvider>
    <Card className="bk-fire-card relative isolate rounded-2xl p-5 pb-5 min-h-[225px] h-full flex flex-col">
      <CardHeader className="p-0 pb-2 flex flex-row items-start justify-between">
        {/* Left: Brand + Title */}
        <div className="flex items-center gap-2 text-left">
          {/* Larger transparent mark with halo pulse */}
          <span className="relative inline-flex items-center justify-center motion-safe:animate-bk-glow-slow">
            <span className="pointer-events-none absolute -inset-3 rounded-2xl blur-md bg-[radial-gradient(closest-side,theme(colors.amber.500/.25),transparent)] motion-safe:animate-pulse-slow" />
            <LogoMark size={36} />
          </span>

          <div className="flex items-center gap-2">
            <CardTitle className="text-base md:text-lg font-semibold text-left bk-title bk-title--glow">
              AI Coach
            </CardTitle>

            {/* Info tooltip moved to the RIGHT */}
            <TooltipProvider>
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    aria-label="What do these scores mean?"
                    className="group inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  align="start"
                  sideOffset={10}
                  className="max-w-[320px] text-xs leading-relaxed"
                >
                  <p>
                    Scores run 0–100. Higher = needs more practice. Example:
                    <span className="ml-1 font-medium">q·49</span> is letter “q”;{" "}
                    <span className="font-medium">sy·57</span> is digraph “s→y”.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {!enabled && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-700/30">Disabled</span>
        )}
      </CardHeader>

      <CardContent className="p-0 pt-2 flex-1">
        {/* Chips */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-white/60 mb-1">Top weak letters</div>
            <div className="flex flex-wrap gap-1.5">
              {letters.length ? (
                letters.map(({ k, score }) => (
                  <span
                    key={k}
                    className="px-2 py-1 rounded-full text-xs bg-rose-500/12 ring-1 ring-rose-500/25 hover:bg-rose-500/15 transition-colors"
                    title={`Letter "${k}" score ${(score * 100) | 0} (higher = more practice)`}
                  >
                    {k}
                    <span className="opacity-60">·</span>
                    {(score * 100) | 0}
                  </span>
                ))
              ) : (
                <span className="text-white/40 text-sm">None yet</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-wider text-white/60 mb-1">Slow digraphs</div>
            <div className="flex flex-wrap gap-1.5">
              {digraphs.length ? (
                digraphs.map(({ k, score }) => (
                  <span
                    key={k}
                    className="px-2 py-1 rounded-full text-xs bg-amber-500/12 ring-1 ring-amber-500/25 hover:bg-amber-500/15 transition-colors"
                    title={`Digraph "${k}" score ${(score * 100) | 0} (higher = more practice)`}
                  >
                    {k}
                    <span className="opacity-60">·</span>
                    {(score * 100) | 0}
                  </span>
                ))
              ) : (
                <span className="text-white/40 text-sm">None yet</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {/* CTA row */}
      <CardFooter className="p-0 mt-auto pt-3">
        <div className="w-full flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          {/* Practice label (not a button) */}
          <div className="flex items-center gap-2 md:mr-auto">
            <CoachBadge />
            <span className="bk-fire-text text-base md:text-lg font-semibold whitespace-nowrap">
              Practice weak spots
            </span>
          </div>

          {/* Two equal buttons */}
          <div className="w-full md:w-auto flex items-stretch gap-3 md:gap-4">
            <Button
              onClick={onPractice}
              disabled={!enabled}
              size="lg"
              className="h-11 flex-1 min-w-[140px] rounded-xl bg-amber-400 text-black hover:bg-amber-300 focus-visible:ring-amber-300"
              aria-label="Practice weak spots for 30 words"
            >
              30 words
            </Button>

            {onPracticeTimed && (
              <Button
                onClick={onPracticeTimed}
                disabled={!enabled}
                size="lg"
                className="h-11 flex-1 min-w-[140px] rounded-xl bg-indigo-500 text-white hover:bg-indigo-500/90 focus-visible:ring-indigo-400"
                aria-label="Practice weak spots for 30 seconds"
              >
                30 sec
              </Button>
            )}
          </div>

          {!hasEvidence && (
            <div className="w-full text-xs text-white/60 md:text-right">
              We’re learning your pattern. Finish a short test and this card adapts.
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
    </TooltipProvider>
  );
}

export default AICoachCard;


