/**
 * components/LeaderboardPrivacyToggle.tsx
 * Lets a signed-in user hide their account from the public tip leaderboards.
 * Backed by GET/PUT /api/tips/leaderboard/opt-out (JWT required).
 */

import { useEffect, useState } from "react";
import { getJwtToken } from "@/lib/auth";
import { apiGet, apiPut } from "@/lib/paymentApi";
import { useTranslation } from "@/contexts/I18nContext";

const OPT_OUT_PATH = "/api/tips/leaderboard/opt-out";

interface OptOutResponse {
  data?: { optedOut?: boolean };
}

export default function LeaderboardPrivacyToggle() {
  const { t } = useTranslation();
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const jwt = getJwtToken();
    setToken(jwt);
    if (!jwt) return;
    apiGet<OptOutResponse>(OPT_OUT_PATH, { auth: true, envelope: false })
      .then((body) => setOptedOut(Boolean(body?.data?.optedOut)))
      .catch(() => setError(t("leaderboardPrivacy.loadError")));
  }, [t]);

  const toggle = async (next: boolean) => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const body = await apiPut<OptOutResponse>(
        OPT_OUT_PATH,
        { optedOut: next },
        { auth: true, envelope: false }
      );
      setOptedOut(Boolean(body?.data?.optedOut));
    } catch {
      setError(t("leaderboardPrivacy.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{t("leaderboardPrivacy.title")}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        {t("leaderboardPrivacy.description")}
      </p>
      {!token ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("leaderboardPrivacy.signInPrompt")}
        </p>
      ) : (
        <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            aria-label={t("leaderboardPrivacy.hideMe")}
            checked={optedOut === true}
            disabled={optedOut === null || saving}
            onChange={(e) => toggle(e.target.checked)}
          />
          {t("leaderboardPrivacy.hideMe")}
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
    </div>
  );
}
