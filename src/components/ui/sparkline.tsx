"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Live error-rate sparkline. Feed it a `series`; the last point carries a
 * pulsing head so it reads as a live feed rather than a static chart.
 */
export function Sparkline({
  series,
  width = 520,
  height = 120,
  className,
  tone = "signal",
  showHead = true,
}: {
  series: number[];
  width?: number;
  height?: number;
  className?: string;
  tone?: "signal" | "ok";
  showHead?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const data = series.length ? series : [0];
  const max = Math.max(...data, 1) * 1.15;
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const pad = 6;
  const w = width;
  const h = height;
  const n = data.length;

  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * (w - pad * 2) + pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);

  const linePts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const linePath = `M ${linePts.join(" L ")}`;
  const areaPath = `${linePath} L ${x(n - 1).toFixed(1)},${h} L ${x(0).toFixed(
    1
  )},${h} Z`;

  const stroke =
    tone === "ok" ? "hsl(var(--lg-ok))" : "hsl(var(--primary))";

  const hx = x(n - 1);
  const hy = y(data[n - 1]);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label="error rate over time"
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* baseline grid */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={w}
          y1={h * f}
          y2={h * f}
          stroke="hsl(var(--lg-hair) / 0.06)"
          strokeWidth={1}
        />
      ))}

      <path d={areaPath} fill={`url(#fill-${id})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {showHead && (
        <g>
          <circle cx={hx} cy={hy} r={7} fill={stroke} opacity={0.18}>
            <animate
              attributeName="r"
              values="4;9;4"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx={hx} cy={hy} r={3} fill={stroke} />
        </g>
      )}
    </svg>
  );
}
