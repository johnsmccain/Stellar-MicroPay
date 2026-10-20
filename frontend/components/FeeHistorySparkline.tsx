/**
 * components/FeeHistorySparkline.tsx
 * Sparkline chart showing network fee trends over 24 hours.
 */

import { useState, useEffect } from "react";
import { LineChart, Line, Tooltip, ResponsiveContainer } from "recharts";
import { formatTime, formatXLM } from "@/utils/intlFormatters";
import { apiGet } from "@/lib/paymentApi";
import { useTranslation } from "@/contexts/I18nContext";

interface FeeDataPoint {
  timestamp: string;
  fee: number;
}

interface FeeHistorySparklineProps {
  className?: string;
}

export default function FeeHistorySparkline({ className = "" }: FeeHistorySparklineProps) {
  const { t } = useTranslation();
  const [feeHistory, setFeeHistory] = useState<FeeDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeeHistory = async () => {
      try {
        const data = await apiGet<FeeDataPoint[]>("/api/network/fee-history", {
          fallbackMessage: t("feeSparkline.fetchFailed"),
        });

        if (Array.isArray(data)) {
          setFeeHistory(data);
        }
      } catch (err) {
        console.error("Error fetching fee history:", err);
        setError(err instanceof Error ? err.message : t("feeSparkline.loadFailed"));
      } finally {
        setLoading(false);
      }
    };

    fetchFeeHistory();
  }, [t]);

  // Convert stroops to XLM for display
  const chartData = feeHistory.map((point) => ({
    time: formatTime(point.timestamp),
    fee: point.fee / 10_000_000, // Convert stroops to XLM
    timestamp: point.timestamp,
  }));

  if (loading) {
    return (
      <div className={`h-16 flex items-center justify-center ${className}`}>
        <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <div className={`h-16 flex items-center justify-center text-slate-400 text-sm ${className}`}>
        {error || t("feeSparkline.noData")}
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <Line
            type="monotone"
            dataKey="fee"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#7c3aed" }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload as FeeDataPoint & { time: string };
                return (
                  <div className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white shadow-lg">
                    <div className="font-semibold">{data.time}</div>
                    <div>{formatXLM(data.fee, { preserveTrailingZeros: true })}</div>
                  </div>
                );
              }
              return null;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
