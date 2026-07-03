"use client";

import { useMemo, useState } from "react";
import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export type ConceptMode = "training" | "web";

export interface ModeScores {
  mode: ConceptMode;
  scores: Record<string, number>;
}

// A brand can carry one or two polygons (training and/or web). When both are
// present for a brand, the overlay toggle lets the user show/hide each mode
// independently on the same axes — "is our web data making us sound better
// than training-only?"
export interface BrandConceptData {
  brandName: string;
  modes: ModeScores[];
}

interface RadarChartProps {
  brands: BrandConceptData[];
  concepts: string[];
}

const BRAND_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
];

const MODE_LABEL: Record<ConceptMode, string> = {
  training: "Training",
  web: "Web",
};

export function RadarChart({ brands, concepts }: RadarChartProps) {
  const series = useMemo(
    () =>
      brands.flatMap((brand, brandIndex) =>
        brand.modes.map((m) => ({
          key: `${brand.brandName}::${m.mode}`,
          brandName: brand.brandName,
          mode: m.mode,
          scores: m.scores,
          color: BRAND_COLORS[brandIndex % BRAND_COLORS.length],
        }))
      ),
    [brands]
  );

  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(series.map((s) => [s.key, true]))
  );

  // A brand is in "overlay mode" when it has both training and web scores —
  // the toggle only needs to appear when there's actually something to
  // compare against.
  const hasOverlay = brands.some((b) => b.modes.length > 1);

  if (concepts.length === 0 || brands.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        No data to display
      </div>
    );
  }

  // Transform data for Recharts — one row per concept, one column per series
  const data = concepts.map((concept) => {
    const point: Record<string, string | number> = { concept };
    for (const s of series) {
      point[s.key] = Math.round((s.scores[concept] || 0) * 100) / 100;
    }
    return point;
  });

  function toggle(key: string) {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  }

  return (
    <div>
      {hasOverlay && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 rounded-lg border bg-gray-50 p-3 text-xs">
          {series.map((s) => (
            <label
              key={s.key}
              className="flex cursor-pointer select-none items-center gap-1.5"
            >
              <input
                type="checkbox"
                checked={visible[s.key] ?? true}
                onChange={() => toggle(s.key)}
                style={{ accentColor: s.color }}
              />
              <span style={{ color: s.color }} className="font-medium">
                {s.brandName}
              </span>
              <span className="text-gray-500">— {MODE_LABEL[s.mode]}</span>
            </label>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <RechartsRadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="concept" tick={{ fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
          {series
            .filter((s) => visible[s.key] ?? true)
            .map((s) => (
              <Radar
                key={s.key}
                name={brands.length > 0 && s.mode ? `${s.brandName} (${MODE_LABEL[s.mode]})` : s.brandName}
                dataKey={s.key}
                stroke={s.color}
                fill={s.color}
                fillOpacity={s.mode === "web" ? 0.25 : 0.1}
                strokeWidth={2}
                strokeDasharray={s.mode === "training" ? "5 4" : undefined}
              />
            ))}
          <Legend />
          <Tooltip />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
