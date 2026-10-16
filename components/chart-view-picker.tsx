"use client";

import type { AnalysisRow } from "@/lib/analysis/types";
import {
  CHART_VIEWS,
  chartUnavailableReason,
  resolveChartView,
  type ChartViewType,
} from "@/lib/analysis/visualization";
import { Icon } from "@/components/app-icons";

export function ChartViewPicker({
  value,
  onChange,
  rows,
  unit,
  includeTable = true,
  scatterDescription,
}: {
  value: ChartViewType;
  onChange: (value: ChartViewType) => void;
  rows: AnalysisRow[];
  unit: string;
  includeTable?: boolean;
  scatterDescription?: string;
}) {
  const effective = resolveChartView(value, unit, rows);
  const fallbackReason = chartUnavailableReason(value, unit, rows);
  return (
    <div className="chart-view-picker">
      <div className="chart-view-options" role="group" aria-label="结果展示方式">
        {CHART_VIEWS.filter((view) => includeTable || view.value !== "table").map((view) => {
          const reason = chartUnavailableReason(view.value, unit, rows);
          return (
            <button
              key={view.value}
              type="button"
              aria-pressed={effective === view.value}
              disabled={Boolean(reason)}
              title={
                reason ??
                (view.value === "scatter" && scatterDescription
                  ? scatterDescription
                  : view.description)
              }
              onClick={() => onChange(view.value)}
            >
              <Icon
                name={
                  view.value === "table" ? "database" : view.value === "bar" ? "chart" : view.value
                }
                size={15}
              />
              {view.label}
            </button>
          );
        })}
      </div>
      <p className="chart-view-description" role="status">
        {fallbackReason
          ? `${fallbackReason} 当前使用柱状图。`
          : effective === "scatter" && scatterDescription
            ? scatterDescription
            : CHART_VIEWS.find((view) => view.value === effective)?.description}
        {!fallbackReason && unit !== "次" && " 占比视图可在活跃次数中使用。"}
      </p>
    </div>
  );
}
