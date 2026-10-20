/**
 * components/AddUsdcTrustline.tsx
 * One-click "Add USDC" button (#1069).
 *
 * If the connected wallet has no USDC trustline (checked via
 * GET /api/accounts/:publicKey/has-usdc-trustline), this component shows a
 * button that builds a changeTrust transaction, asks Freighter to sign it,
 * and submits it — after which the USDC balance appears on the dashboard.
 */

import { useCallback, useEffect, useState } from "react";
import {
  USDC_ISSUER,
  buildChangeTrustTransaction,
  submitTransaction,
} from "@/lib/stellar";
import { apiGet, isApiError } from "@/lib/paymentApi";
import { signTransactionWithWallet } from "@/lib/wallet";
import { useTranslation } from "@/contexts/I18nContext";

interface AddUsdcTrustlineProps {
  publicKey: string | null;
  onTrustlineAdded?: () => void;
}

export default function AddUsdcTrustline({
  publicKey,
  onTrustlineAdded,
}: AddUsdcTrustlineProps) {
  const { t } = useTranslation();
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkTrustline = useCallback(async () => {
    if (!publicKey) {
      setHasTrustline(null);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const payload = await apiGet<{ hasTrustline?: boolean }>(
        `/api/accounts/${encodeURIComponent(publicKey)}/has-usdc-trustline`,
        { envelope: false }
      );
      setHasTrustline(Boolean(payload?.hasTrustline));
    } catch (err) {
      setError(
        isApiError(err) && err.status > 0
          ? t("trustline.checkFailed", { status: err.status })
          : err instanceof Error && err.message
            ? err.message
            : t("trustline.checkFailedFallback")
      );
      setHasTrustline(null);
    } finally {
      setChecking(false);
    }
  }, [publicKey, t]);

  useEffect(() => {
    void checkTrustline();
  }, [checkTrustline]);

  const handleAddUsdc = useCallback(async () => {
    if (!publicKey || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const tx = await buildChangeTrustTransaction({
        fromPublicKey: publicKey,
        assetCode: "USDC",
        issuer: USDC_ISSUER,
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(
        tx.toXDR()
      );
      if (signError || !signedXDR) {
        throw new Error(signError || t("trustline.signFailed"));
      }
      await submitTransaction(signedXDR);
      setHasTrustline(true);
      onTrustlineAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("trustline.addFailedFallback"));
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, submitting, onTrustlineAdded, t]);

  if (!publicKey || checking || hasTrustline !== false) {
    return null;
  }

  return (
    <div
      className="card mb-6 border-blue-500/30 bg-blue-500/5"
      data-testid="add-usdc-trustline"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="font-semibold text-white mb-1">{t("trustline.enableTitle")}</p>
          <p className="text-sm text-slate-400">
            {t("trustline.description")}
          </p>
          {error && (
            <p className="text-sm text-red-300 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleAddUsdc()}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors cursor-pointer"
        >
          {submitting ? t("trustline.adding") : t("trustline.add")}
        </button>
      </div>
    </div>
  );
}
