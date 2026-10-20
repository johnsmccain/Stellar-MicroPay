/**
 * components/DashboardCharts.tsx
 *
 * The recharts-powered dashboard widgets, kept out of `pages/dashboard.tsx` so
 * the charting library is not part of the dashboard's initial bundle. The page
 * imports these through `next/dynamic`, which puts recharts in its own async
 * chunk that only downloads when the analytics widgets mount (#1442).
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useTranslation } from "@/contexts/I18nContext";

/**
 * One bar in the monthly spending chart.
 *
 * `monthIndex`, `year` and `label` are optional so a caller that only knows
 * the month name can hand the chart a plain `{ month, sent, received }` row
 * (#1152) without having to invent the derived fields.
 */
export interface MonthlySpendingPoint {
  month: string;
  monthIndex?: number;
  year?: number;
  label?: string;
  sent: number;
  received: number;
}

/** One bar in the 30-day volume chart. */
export interface ThirtyDayVolumePoint {
  day: string;
  dateKey?: string;
  sent: number;
  received: number;
}

/** One point in the balance history line chart. */
export interface BalanceHistoryPoint {
  date: string;
  balance: number;
  timestamp: number;
}

const AXIS_TICK = { fill: "#94a3b8", fontSize: 12 };

const TOOLTIP_STYLE = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "8px",
};

export function MonthlySpendingChart({
  data,
  loading,
  onBarClick,
}: {
  data: MonthlySpendingPoint[];
  loading: boolean;
  onBarClick: (data: MonthlySpendingPoint) => void;
}) {
  const { t } = useTranslation();

  if (loading && data.length === 0) {
    return (
      <div className="card mb-6 h-[350px] animate-pulse bg-white/[0.03] border-white/10" />
    );
  }

  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-white mb-6">
        {t("dashboard.monthlySpending")}
      </h2>
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            onClick={(state) => {
              // `activeTooltipIndex` is the index of the column the pointer is
              // over, so a click anywhere in the column selects that month.
              const index = state?.activeTooltipIndex;
              if (typeof index === "number" && data[index]) onBarClick(data[index]);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: any) => `${value}`}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ThirtyDayVolumeChart({
  data,
  loading,
}: {
  data: ThirtyDayVolumePoint[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading && data.length === 0) {
    return <div className="card mb-6 h-[280px] animate-pulse bg-white/[0.03] border-white/10" />;
  }
  const visibleData = data.filter((_, i) => i % 5 === 0 || i === data.length - 1);
  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-white mb-6">{t("dashboard.thirtyDayVolumeTitle")}</h2>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              ticks={visibleData.map((d) => d.day)}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" name={t("dashboard.sent")} radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" fill="#34d399" name={t("dashboard.received")} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BalanceHistoryChart({
  data,
  loading,
}: {
  data: BalanceHistoryPoint[];
  loading: boolean;
}) {
  if (loading && data.length === 0) {
    return (
      <div className="card mb-6 h-[350px] animate-pulse bg-white/[0.03] border-white/10" />
    );
  }

  if (data.length < 2) {
    return (
      <div className="card mb-6 overflow-hidden">
        <h2 className="font-display text-lg font-semibold text-white mb-4">
          Balance History (Past 30 Days)
        </h2>
        <div className="flex flex-col items-center justify-center h-[200px] text-center border border-dashed border-white/10 rounded-xl bg-white/[0.02] p-4">
          <p className="text-slate-300 font-medium text-sm">Insufficient history</p>
          <p className="text-slate-500 text-xs mt-1">
            At least 2 payment events in the last 30 days are required to render the balance chart.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-lg font-semibold text-white">
          Balance History (Past 30 Days)
        </h2>
        <span className="text-xs text-stellar-400 font-medium">
          {data.length} payment events
        </span>
      </div>
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: any) => `${value}`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(val) => [`${val} XLM`, "Balance"]}
            />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={{ fill: "#38bdf8", r: 3 }}
              activeDot={{ r: 5, fill: "#0284c7" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
