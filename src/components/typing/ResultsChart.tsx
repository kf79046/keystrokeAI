"use client";

import React from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Filler,
  LineElement,
  LinearScale,
  Plugin,
  PointElement,
  ScriptableContext,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
);

export type ResultsChartPoint = { second: number; wpm: number };

type Props = {
  chartData: readonly ResultsChartPoint[];
  reducedMotion?: boolean;
  onFirstPaint?: () => void;
  className?: string;
};

export function computeCenteredYRange(
  values: readonly number[],
  opts?: { pad?: number; minSpan?: number; floor?: number },
) {
  const pad = opts?.pad ?? 0.25;
  const minSpan = opts?.minSpan ?? 30;
  const floor = opts?.floor ?? 0;
  if (!values.length) return { min: 0, max: minSpan };

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const deviation = Math.max(mean - minValue, maxValue - mean, minSpan / 2);
  let min = Math.max(floor, mean - deviation * (1 + pad));
  let max = mean + deviation * (1 + pad);
  if (max - min < minSpan) {
    const extra = (minSpan - (max - min)) / 2;
    min = Math.max(floor, min - extra);
    max += extra;
  }
  return { min, max };
}

function niceStep(min: number, max: number, approximateTicks = 6) {
  const rough = Math.max(1, max - min) / approximateTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].find((choice) => choice * magnitude >= rough) ?? 10;
  return step * magnitude;
}

const frameGlow: Plugin<"line"> = {
  id: "bk-frame-glow",
  afterDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, right, top, bottom } = chartArea;
    const width = right - left;
    const height = bottom - top;
    const radius = Math.min(8, width / 10, height / 10);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left + 0.5, top + 0.5, width - 1, height - 1, radius);
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(255, 115, 35, 0.28)";
    ctx.strokeStyle = "rgba(255, 145, 65, 0.72)";
    ctx.stroke();
    ctx.restore();
  },
};

function strokeGradient(context: ScriptableContext<"line">) {
  const chart = context.chart;
  const area = chart?.chartArea;
  if (!chart || !area) return "#fb923c";
  const gradient = chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
  gradient.addColorStop(0, "#f97316");
  gradient.addColorStop(0.55, "#fb923c");
  gradient.addColorStop(1, "#fdba74");
  return gradient;
}

function fillGradient(context: ScriptableContext<"line">) {
  const chart = context.chart;
  const area = chart?.chartArea;
  if (!chart || !area) return "rgba(249, 115, 22, 0.08)";
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, "rgba(251, 146, 60, 0.18)");
  gradient.addColorStop(1, "rgba(249, 115, 22, 0.01)");
  return gradient;
}

function ResultsChart({
  chartData,
  reducedMotion = false,
  onFirstPaint,
  className,
}: Props) {
  const values = React.useMemo(
    () => chartData.map((point) => point.wpm),
    [chartData],
  );
  const labels = React.useMemo(
    () => chartData.map((point) => Number(point.second.toFixed(2))),
    [chartData],
  );
  const yRange = React.useMemo(
    () => computeCenteredYRange(values, { pad: 0.25, minSpan: 30, floor: 0 }),
    [values],
  );

  const data = React.useMemo<ChartData<"line">>(
    () => ({
      labels,
      datasets: [
        {
          label: "WPM",
          data: values,
          borderColor: strokeGradient,
          backgroundColor: fillGradient,
          fill: true,
          borderWidth: 2.5,
          pointRadius: (context) =>
            context.dataIndex === values.length - 1 ? 3.5 : 0,
          pointBackgroundColor: "#fdba74",
          pointBorderColor: "#f97316",
          pointBorderWidth: 1.5,
          pointHoverRadius: 5,
          tension: values.length > 2 ? 0.34 : 0,
        },
      ],
    }),
    [labels, values],
  );

  const options = React.useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      resizeDelay: 90,
      layout: { padding: { left: 34, right: 12, top: 8, bottom: 36 } },
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(9, 9, 11, 0.94)",
          borderColor: "rgba(251, 146, 60, 0.42)",
          borderWidth: 1,
          cornerRadius: 10,
          displayColors: false,
          padding: 10,
          titleColor: "rgba(255, 255, 255, 0.62)",
          bodyColor: "#fed7aa",
          titleFont: {
            family: "Inter, ui-sans-serif, system-ui, sans-serif",
            size: 11,
            weight: 500,
          },
          bodyFont: {
            family: "Inter, ui-sans-serif, system-ui, sans-serif",
            size: 13,
            weight: 650,
          },
          callbacks: {
            title: (items) => `${items[0]?.label ?? 0}s elapsed`,
            label: (item) => `${Math.round(Number(item.raw))} WPM`,
          },
        },
      },
      elements: {
        point: { hitRadius: 16, hoverRadius: 5 },
      },
      scales: {
        x: {
          grid: {
            color: "rgba(255, 255, 255, 0.09)",
            lineWidth: 1,
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            color: "rgba(255, 255, 255, 0.66)",
            padding: 8,
            maxTicksLimit: 12,
            font: {
              family: "Inter, ui-sans-serif, system-ui, sans-serif",
              size: 11,
              weight: 500,
            },
          },
          title: { display: false },
        },
        y: {
          min: yRange.min,
          max: yRange.max,
          grid: {
            color: "rgba(255, 255, 255, 0.09)",
            lineWidth: 1,
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            color: "rgba(255, 255, 255, 0.66)",
            padding: 8,
            stepSize: niceStep(yRange.min, yRange.max),
            font: {
              family: "Inter, ui-sans-serif, system-ui, sans-serif",
              size: 11,
              weight: 500,
            },
          },
          title: { display: false },
        },
      },
    }),
    [yRange],
  );

  React.useEffect(() => {
    if (!onFirstPaint) return;
    const frame = requestAnimationFrame(onFirstPaint);
    return () => cancelAnimationFrame(frame);
  }, [onFirstPaint]);

  return (
    <div
      className={`relative size-full ${className ?? ""}`}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bk-chart-halo opacity-70"
      />
      <div aria-hidden className="bk-chart-axis-label bk-chart-axis-label--y">
        <span className="bk-chart-axis-label__dot" />
        <span>Speed</span>
        <strong>WPM</strong>
      </div>
      <div aria-hidden className="bk-chart-axis-label bk-chart-axis-label--x">
        <span className="bk-chart-axis-label__dot" />
        <span>Elapsed</span>
        <strong>Seconds</strong>
      </div>
      <Line data={data} options={options} plugins={[frameGlow]} />
    </div>
  );
}

export default React.memo(ResultsChart);
