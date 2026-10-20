/**
 * pages/network.tsx
 * Stellar network status page.
 *
 * Shows live network health sourced from Horizon:
 *   - the root endpoint (`/`) for the current ledger, close time and versions
 *   - `/fee_stats` for base, recommended and tail fees
 *   - `/ledgers` for operations per second
 *   - `/ledgers/{seq}/operations` for active accounts
 *
 * Horizon latencies are measured client-side on every refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { fetchNetworkMetrics, type NetworkMetrics } from "@/lib/stellar";
import { type Translate } from "@/lib/i18n";
import { useTranslation } from "@/contexts/I18nContext";
import {
  formatDate,
  formatNumber,
  formatTime,
} from "@/utils/intlFormatters";

/** How often the page re-reads Horizon. */
const AUTO_REFRESH_MS = 10_000;

type LoadState = "connecting" | "ready" | "error";

/** A single metric row. `value` is `null` when Horizon could not supply it. */
interface MetricRow {
  key: string;
  metric: string;
  value: string;
  unit: string;
  detail?: string;
}

function formatLedgerSequence(sequence: number): string {
  return `#${formatNumber(sequence, "XLM", { maximumFractionDigits: 0 })}`;
}

/** Localized UTC rendering, e.g. `Sep 24, 2026, 10:35 AM UTC`. */
function formatUtc(isoTimestamp: string, t: Translate): string {
  if (Number.isNaN(new Date(isoTimestamp).getTime())) return t("network.unknown");
  return formatDate(isoTimestamp, { timezone: "UTC" });
}

function formatXlm(amount: number): string {
  return formatNumber(amount, "XLM", {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  });
}

function formatCount(value: number | null, t: Translate): string {
  return value === null
    ? t("network.unavailable")
    : formatNumber(value, "XLM", { maximumFractionDigits: 0 });
}

function buildMetricRows(metrics: NetworkMetrics, t: Translate): MetricRow[] {
  return [
    {
      key: "ledger",
      metric: t("network.latestLedger"),
      value: formatLedgerSequence(metrics.latestLedgerSequence),
      unit: t("network.sequenceNumberUnit"),
      detail: t("network.latestLedgerDetail"),
    },
    {
      key: "close-time",
      metric: t("network.lastCloseTime"),
      value: formatUtc(metrics.lastLedgerCloseTime, t),
      unit: "UTC",
      detail: t("network.lastCloseTimeDetail"),
    },
    {
      key: "close-lag",
      metric: t("network.timeSinceClose"),
      value: formatNumber(metrics.ledgerCloseLagSeconds, "XLM", { maximumFractionDigits: 0 }),
      unit: t("network.secondsUnit"),
      detail: t("network.closeLagDetail"),
    },
    {
      key: "base-fee",
      metric: t("network.baseFee"),
      value: formatXlm(metrics.baseFeeXlm),
      unit: "XLM",
      detail: t("network.baseFeeDetail"),
    },
    {
      key: "recommended-fee",
      metric: t("network.recommendedFee"),
      value: formatXlm(metrics.recommendedFeeXlm),
      unit: "XLM",
      detail: t("network.recommendedFeeDetail"),
    },
    {
      key: "p95-fee",
      metric: t("network.p95Fee"),
      value: formatXlm(metrics.feeP95Xlm),
      unit: "XLM",
      detail: t("network.p95FeeDetail"),
    },
    {
      key: "p99-fee",
      metric: t("network.p99Fee"),
      value: formatXlm(metrics.feeP99Xlm),
      unit: "XLM",
      detail: t("network.p99FeeDetail"),
    },
    {
      key: "active-accounts",
      metric: t("network.activeAccounts"),
      value: formatCount(metrics.activeAccounts, t),
      unit: t("network.accountsUnit"),
      detail: t("network.activeAccountsDetail", {
        ledger: formatLedgerSequence(metrics.activeAccountsLedger),
      }),
    },
    {
      key: "ops-per-second",
      metric: t("network.opsPerSecond"),
      value:
        metrics.operationsPerSecond === null
          ? t("network.unavailable")
          : formatNumber(metrics.operationsPerSecond, "XLM", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      unit: "ops/s",
      detail: t("network.opsPerSecondDetail", { count: metrics.sampledLedgerCount }),
    },
    {
      key: "horizon-latency",
      metric: t("network.horizonRootLatency"),
      value: formatNumber(metrics.horizonLatencyMs, "XLM", { maximumFractionDigits: 0 }),
      unit: t("network.millisecondsUnit"),
      detail: t("network.measuredClientSide"),
    },
    {
      key: "fee-stats-latency",
      metric: t("network.horizonFeeStatsLatency"),
      value: formatNumber(metrics.feeStatsLatencyMs, "XLM", { maximumFractionDigits: 0 }),
      unit: t("network.millisecondsUnit"),
      detail: t("network.measuredClientSide"),
    },
    {
      key: "fee-level",
      metric: t("network.feeLevel"),
      value: metrics.feeLevel,
      unit: t("network.bandUnit"),
      detail: t("network.feeLevelDetail"),
    },
    {
      key: "protocol",
      metric: t("network.protocolVersion"),
      value: metrics.protocolVersion === null ? t("network.unknown") : String(metrics.protocolVersion),
      unit: t("network.versionUnit"),
    },
    {
      key: "passphrase",
      metric: t("network.networkPassphrase"),
      value: metrics.networkPassphrase ?? t("network.unknown"),
      unit: t("network.identifierUnit"),
    },
    {
      key: "horizon-version",
      metric: t("network.horizonVersion"),
      value: metrics.horizonVersion ?? t("network.unknown"),
      unit: t("network.buildUnit"),
    },
    {
      key: "core-version",
      metric: t("network.coreVersion"),
      value: metrics.coreVersion ?? t("network.unknown"),
      unit: t("network.buildUnit"),
    },
  ];
}

function ConnectingSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-300 font-medium">{t("network.connecting")}</p>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        {t("network.connectingHint")}
      </p>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <div className="h-4 w-1/3 rounded bg-white/5 animate-pulse" />
            <div className="h-4 w-1/4 rounded bg-white/5 animate-pulse" />
            <div className="h-4 w-1/6 rounded bg-white/5 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Network() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<NetworkMetrics | null>(null);
  const [status, setStatus] = useState<LoadState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [ledgerPulse, setLedgerPulse] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track the last ledger we rendered without re-creating the refresh callback.
  const previousLedgerRef = useRef<number | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await fetchNetworkMetrics();

      if (
        previousLedgerRef.current !== null &&
        next.latestLedgerSequence !== previousLedgerRef.current
      ) {
        setLedgerPulse(true);
        window.setTimeout(() => setLedgerPulse(false), 1200);
      }

      previousLedgerRef.current = next.latestLedgerSequence;
      setMetrics(next);
      setStatus("ready");
      setError(null);
      setRefreshError(null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error("Failed to load network metrics:", err);
      const message =
        err instanceof Error ? err.message : t("network.loadFailed");

      // Keep the last good snapshot on screen; only blank the page if we have
      // never successfully loaded anything.
      setMetrics((current) => {
        if (current) {
          setRefreshError(message);
          return current;
        }
        setError(message);
        setStatus("error");
        return current;
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    loadMetrics();

    const intervalId = window.setInterval(loadMetrics, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadMetrics]);

  const header = (
    <div className="text-center mb-10">
      <h1 className="font-display text-3xl font-bold text-white mb-3">
        {t("network.pageTitle")}
      </h1>
      <p className="text-slate-400">
        {t("network.pageSubtitle")}
      </p>
    </div>
  );

  if (status === "connecting") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <Head>
          <title>{t("pages.network.title")}</title>
        </Head>
        {header}
        <ConnectingSkeleton />
      </div>
    );
  }

  if (status === "error" || !metrics) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <Head>
          <title>{t("pages.network.title")}</title>
        </Head>
        {header}
        <div className="text-center" role="alert">
          <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="font-display text-2xl font-bold text-white mb-2">
            {t("network.networkError")}
          </h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <button onClick={loadMetrics} className="btn-primary">
            {t("network.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  const rows = buildMetricRows(metrics, t);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <Head>
        <title>{t("pages.network.title")}</title>
        <meta
          name="description"
          content="Live Stellar network health: ledger sequence, close time, fees, active accounts, operations per second and Horizon latency."
        />
      </Head>

      {header}

      {refreshError && (
        <div
          className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
          role="status"
        >
          {t("network.refreshFailed", { error: refreshError })}
        </div>
      )}

      {/* Live ledger ticker */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                ledgerPulse ? "bg-emerald-400 animate-ping" : "bg-emerald-500/60"
              }`}
              aria-hidden="true"
            />
            <span className="text-sm text-slate-400" aria-live="polite">
              {ledgerPulse ? t("network.newLedgerClosed") : t("network.waitingForLedger")}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              {t("network.latestLedger")}
            </span>
            <p
              className={`font-display text-2xl font-bold transition-colors ${
                ledgerPulse ? "text-emerald-400" : "text-white"
              }`}
            >
              {formatLedgerSequence(metrics.latestLedgerSequence)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {isRefreshing
            ? t("network.refreshing")
            : lastUpdatedAt
            ? t("network.lastUpdated", { time: formatTime(lastUpdatedAt) })
            : t("network.awaitingFirstReading")}
        </p>
      </div>

      {/* Accessible metric table */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <caption className="px-6 py-4 text-left font-display text-lg font-semibold text-white border-b border-white/5">
            {t("network.tableCaption")}
            <span className="block text-xs font-normal text-slate-500 mt-1">
              {t("network.tableCaptionHint")}
            </span>
          </caption>
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-6 py-3 font-medium">
                {t("network.metricColumn")}
              </th>
              <th scope="col" className="px-6 py-3 font-medium">
                {t("network.valueColumn")}
              </th>
              <th scope="col" className="px-6 py-3 font-medium">
                {t("network.unitColumn")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <th
                  scope="row"
                  className="px-6 py-3 align-top font-medium text-slate-300"
                >
                  {row.metric}
                  {row.detail && (
                    <span className="block text-xs font-normal text-slate-500 mt-0.5">
                      {row.detail}
                    </span>
                  )}
                </th>
                <td className="px-6 py-3 align-top font-mono text-white break-all">
                  {row.value}
                </td>
                <td className="px-6 py-3 align-top text-slate-400">{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
