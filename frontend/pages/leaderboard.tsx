import Head from "next/head";
import { useEffect, useState } from "react";
import { shortenAddress } from "@/utils/format";
import { apiGet } from "@/lib/paymentApi";
import { useTranslation } from "@/contexts/I18nContext";
import { formatNumber } from "@/utils/intlFormatters";

type Entry = { publicKey: string; totalXLM: string; federationName?: string | null };
type Leaderboard = { recipients: Entry[]; senders: Entry[]; totalTips: number; totalXLM: string };

function Ranking({ title, entries }: { title: string; entries: Entry[] }) {
  const { t } = useTranslation();
  return (
    <section className="card overflow-hidden">
      <h2 className="mb-4 font-display text-xl font-semibold text-white">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th scope="col" className="py-2">{t("leaderboard.rank")}</th><th scope="col">{t("leaderboard.account")}</th><th scope="col" className="text-right">XLM</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {entries.map((entry, index) => (
              <tr key={entry.publicKey}>
                <th scope="row" className="py-3 font-medium text-slate-400">{index + 1}</th>
                <td className="font-mono text-slate-200" title={entry.publicKey}>{entry.federationName || shortenAddress(entry.publicKey, 8)}</td>
                <td className="text-right font-semibold text-stellar-300">{formatNumber(entry.totalXLM, "XLM")}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-slate-500">{t("leaderboard.noTipsYet")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const body = await apiGet<{ data?: Leaderboard }>(
          "/api/tips/leaderboard",
          { envelope: false, fallbackMessage: t("leaderboard.loadError") }
        );
        if (active) { setData(body?.data ?? null); setError(""); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : t("leaderboard.loadError")); }
    };
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [t]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Head><title>Community Tips Leaderboard | Stellar MicroPay</title></Head>
      <div className="mb-8 text-center"><h1 className="font-display text-4xl font-bold text-white">{t("leaderboard.title")}</h1><p className="mt-2 text-slate-400">{t("leaderboard.subtitle")}</p></div>
      {error && <p role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-300">{error}</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2"><div className="card text-center"><p className="text-sm text-slate-400">{t("leaderboard.tipsProcessed")}</p><p className="mt-1 text-3xl font-bold text-white">{data ? formatNumber(data.totalTips, "XLM", { maximumFractionDigits: 0 }) : "—"}</p></div><div className="card text-center"><p className="text-sm text-slate-400">{t("leaderboard.totalXlmTipped")}</p><p className="mt-1 text-3xl font-bold text-stellar-300">{data ? formatNumber(data.totalXLM, "XLM") : "—"}</p></div></div>
      <div className="grid gap-6 lg:grid-cols-2"><Ranking title={t("leaderboard.topRecipients")} entries={data?.recipients ?? []} /><Ranking title={t("leaderboard.topSenders")} entries={data?.senders ?? []} /></div>
    </main>
  );
}
