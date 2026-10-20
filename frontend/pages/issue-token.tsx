/**
 * pages/issue-token.tsx
 * Five-step wizard for issuing a custom Stellar asset.
 *
 *   1. Asset code       — validated 1–12 uppercase A–Z / 0–9 characters
 *   2. Issuer           — defaults to the connected wallet
 *   3. Distribute       — distributor creates a trustline for the asset
 *   4. Issue            — issuer sends the asset to the distributor
 *   5. Finalise         — optional home domain + stellar.toml, then a summary
 *
 * Steps 3, 4 and 5 each build and sign their own transaction through Freighter.
 */

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { Transaction } from "@stellar/stellar-sdk";
import WalletConnect from "@/components/WalletConnect";
import { formatAsset } from "@/utils/intlFormatters";
import {
  ASSET_CODE_MAX_LENGTH,
  assetExplorerUrl,
  buildAssetIssueTransaction,
  buildChangeTrustTransaction,
  buildHomeDomainTransaction,
  buildStellarToml,
  explorerUrl,
  getNetwork,
  isValidStellarAddress,
  shortenAddress,
  stellarTomlUrl,
  submitTransaction,
  validateAssetCode,
  validateHomeDomain,
} from "@/lib/stellar";
import { getConnectedPublicKey, signTransactionWithWallet } from "@/lib/wallet";
import { useWallet } from "@/lib/useWallet";
import { useTranslation } from "@/contexts/I18nContext";
import { copyToClipboard } from "@/utils/format";

const WIZARD_STEPS = [
  { id: 1, titleKey: "issueToken.assetCode", hintKey: "issueToken.assetCodeStepHint" },
  { id: 2, titleKey: "issueToken.issuer", hintKey: "issueToken.issuerStepHint" },
  { id: 3, titleKey: "issueToken.distribute", hintKey: "issueToken.distributeStepHint" },
  { id: 4, titleKey: "issueToken.issue", hintKey: "issueToken.issueStepHint" },
  { id: 5, titleKey: "issueToken.finalise", hintKey: "issueToken.finaliseStepHint" },
] as const;

type StepId = (typeof WIZARD_STEPS)[number]["id"];

interface IssuanceTransactions {
  trustline?: string;
  issue?: string;
  homeDomain?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function IssueTokenPage() {
  const { publicKey } = useWallet();
  const { t } = useTranslation();
  const network = getNetwork();

  const [step, setStep] = useState<StepId>(1);
  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [distributor, setDistributor] = useState("");
  const [amount, setAmount] = useState("1000");
  const [homeDomain, setHomeDomain] = useState("");
  const [trustlineSkipped, setTrustlineSkipped] = useState(false);
  const [transactions, setTransactions] = useState<IssuanceTransactions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Default the issuer to the connected wallet (issue #1147 step 2).
  useEffect(() => {
    if (publicKey && !issuer) setIssuer(publicKey);
  }, [publicKey, issuer]);

  const codeError = useMemo(
    () => (assetCode ? validateAssetCode(assetCode) : null),
    [assetCode]
  );
  const issuerError =
    issuer && !isValidStellarAddress(issuer)
      ? t("issueToken.invalidPublicKey")
      : null;
  const distributorError = distributor
    ? !isValidStellarAddress(distributor)
      ? t("issueToken.invalidPublicKey")
      : distributor === issuer
      ? t("issueToken.distributorMustDiffer")
      : null
    : null;
  const amountError =
    amount && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      ? t("issueToken.invalidAmount")
      : null;
  const homeDomainError = validateHomeDomain(homeDomain);

  const canContinue = (() => {
    switch (step) {
      case 1:
        return validateAssetCode(assetCode) === null;
      case 2:
        return isValidStellarAddress(issuer);
      case 3:
        return (
          isValidStellarAddress(distributor) &&
          distributor !== issuer &&
          (Boolean(transactions.trustline) || trustlineSkipped)
        );
      case 4:
        return (
          Number.isFinite(Number(amount)) &&
          Number(amount) > 0 &&
          Boolean(transactions.issue)
        );
      default:
        return homeDomainError === null;
    }
  })();

  const toml = useMemo(
    () =>
      buildStellarToml({
        homeDomain,
        assetCode: assetCode || "ASSET",
        issuerPublicKey: issuer || "G…",
        network,
      }),
    [homeDomain, assetCode, issuer, network]
  );

  /** Sign with Freighter (verifying the active account) and submit. */
  const signAndSubmit = async (
    build: () => Promise<Transaction>,
    expectedSigner: string
  ): Promise<string> => {
    const transaction = await build();

    const activeAccount = await getConnectedPublicKey();
    if (activeAccount && activeAccount !== expectedSigner) {
      throw new Error(
        t("issueToken.freighterAccountMismatch", {
          active: shortenAddress(activeAccount),
          expected: shortenAddress(expectedSigner),
        })
      );
    }

    const { signedXDR, error: signError } = await signTransactionWithWallet(
      transaction.toXDR()
    );
    if (signError || !signedXDR) {
      throw new Error(signError || t("issueToken.signingCancelled"));
    }

    const result = await submitTransaction(signedXDR);
    return result.hash;
  };

  const runStep = async (action: () => Promise<string>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successMessage);
    } catch (err) {
      setError(errorMessage(err, t("issueToken.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTrustline = () =>
    runStep(async () => {
      const hash = await signAndSubmit(
        () =>
          buildChangeTrustTransaction({
            fromPublicKey: distributor.trim(),
            assetCode,
            issuer: issuer.trim(),
          }),
        distributor.trim()
      );
      setTransactions((current) => ({ ...current, trustline: hash }));
      return hash;
    }, t("issueToken.trustlineCreated"));

  const handleIssue = () =>
    runStep(async () => {
      const hash = await signAndSubmit(
        () =>
          buildAssetIssueTransaction({
            issuerPublicKey: issuer.trim(),
            distributorPublicKey: distributor.trim(),
            assetCode,
            amount: Number(amount).toFixed(7),
          }),
        issuer.trim()
      );
      setTransactions((current) => ({ ...current, issue: hash }));
      return hash;
    }, t("issueToken.assetIssuedToDistributor"));

  const handleSetHomeDomain = () =>
    runStep(async () => {
      const domain = homeDomain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      const hash = await signAndSubmit(
        () => buildHomeDomainTransaction({ publicKey: issuer.trim(), homeDomain: domain }),
        issuer.trim()
      );
      setTransactions((current) => ({ ...current, homeDomain: hash }));
      return hash;
    }, t("issueToken.homeDomainSet"));

  const handleCopyToml = async () => {
    const ok = await copyToClipboard(toml);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">
            {t("issueToken.pageTitle")}
          </h1>
          <p className="text-slate-400">
            {t("issueToken.connectPrompt")}
          </p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  const currentStep = WIZARD_STEPS.find((entry) => entry.id === step)!;

  return (
    <>
      <Head>
        <title>{t("pages.issueToken.title")}</title>
        <meta
          name="description"
          content="Issue a custom Stellar asset: pick an asset code, set the issuer and distributor, create a trustline, issue the asset and publish a stellar.toml."
        />
      </Head>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-white mb-1">
            {t("issueToken.pageTitle")}
          </h1>
          <p className="text-slate-400 text-sm">
            {t("issueToken.subtitleLead")}{" "}
            <span className="font-mono text-slate-300">{network}</span>.
          </p>
        </div>

        {/* Step indicator */}
        <ol
          className="mb-8 grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs"
          aria-label={t("issueToken.progressAria")}
        >
          {WIZARD_STEPS.map((entry) => {
            const isCurrent = entry.id === step;
            const isDone = entry.id < step;
            return (
              <li
                key={entry.id}
                aria-current={isCurrent ? "step" : undefined}
                className={`rounded-lg border px-3 py-2 ${
                  isCurrent
                    ? "border-stellar-500/40 bg-stellar-500/10 text-stellar-200"
                    : isDone
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-400"
                }`}
              >
                <span className="block font-medium">
                  {entry.id}. {t(entry.titleKey)}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {t(entry.hintKey)}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-white mb-1">
            {t("issueToken.stepHeading", {
              current: currentStep.id,
              total: WIZARD_STEPS.length,
              title: t(currentStep.titleKey),
            })}
          </h2>
          <p className="text-sm text-slate-400 mb-6">{t(currentStep.hintKey)}</p>

          {error && (
            <p
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              role="alert"
            >
              {error}
            </p>
          )}
          {success && (
            <p
              className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
              role="status"
            >
              {success}
            </p>
          )}

          {/* ── Step 1: asset code ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <label
                htmlFor="asset-code"
                className="block text-sm font-medium text-slate-300"
              >
                {t("issueToken.assetCode")}
              </label>
              <input
                id="asset-code"
                value={assetCode}
                onChange={(event) => setAssetCode(event.target.value.toUpperCase())}
                maxLength={ASSET_CODE_MAX_LENGTH}
                placeholder="COOL"
                aria-invalid={Boolean(codeError)}
                aria-describedby="asset-code-help"
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono uppercase focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              <p id="asset-code-help" className="text-xs text-slate-500">
                {t("issueToken.assetCodeHelp", { max: ASSET_CODE_MAX_LENGTH })}{" "}
                <span className="font-mono">XLM</span> {t("issueToken.xlmReserved")}
              </p>
              {codeError && (
                <p className="text-xs text-red-400" role="alert">
                  {codeError}
                </p>
              )}
            </div>
          )}

          {/* ── Step 2: issuer ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <label
                htmlFor="issuer"
                className="block text-sm font-medium text-slate-300"
              >
                {t("issueToken.issuerAccount")}
              </label>
              <input
                id="issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value.trim())}
                aria-invalid={Boolean(issuerError)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono text-sm focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setIssuer(publicKey)}
                  className="text-stellar-400 hover:text-stellar-300"
                >
                  {t("issueToken.useConnectedWallet")}
                </button>
                <span className="text-slate-500">
                  {issuer === publicKey
                    ? t("issueToken.usingConnectedWallet")
                    : t("issueToken.freighterHint")}
                </span>
              </div>
              {issuerError && (
                <p className="text-xs text-red-400" role="alert">
                  {issuerError}
                </p>
              )}
            </div>
          )}

          {/* ── Step 3: distribute ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <label
                  htmlFor="distributor"
                  className="block text-sm font-medium text-slate-300"
                >
                  {t("issueToken.distributorAccount")}
                </label>
                <input
                  id="distributor"
                  value={distributor}
                  onChange={(event) => setDistributor(event.target.value.trim())}
                  aria-invalid={Boolean(distributorError)}
                  placeholder="G…"
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono text-sm focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                />
                {distributorError && (
                  <p className="text-xs text-red-400" role="alert">
                    {distributorError}
                  </p>
                )}
              </div>

              <p className="text-xs text-slate-500">
                {t("issueToken.distributorSignHint")}
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCreateTrustline}
                  disabled={busy || !distributor || Boolean(distributorError)}
                  className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? t("issueToken.waitingForSignature") : t("issueToken.createTrustline")}
                </button>
                <button
                  type="button"
                  onClick={() => setTrustlineSkipped(true)}
                  className="btn-secondary"
                >
                  {t("issueToken.distributorTrusts", { asset: assetCode || t("issueToken.thisAsset") })}
                </button>
              </div>

              {transactions.trustline && (
                <p className="text-xs text-emerald-300">
                  {t("issueToken.trustlineTransaction")}{" "}
                  <a
                    href={explorerUrl(transactions.trustline)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline underline-offset-2"
                  >
                    {transactions.trustline.slice(0, 12)}…
                  </a>
                </p>
              )}
            </div>
          )}

          {/* ── Step 4: issue ─────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-3">
              <label
                htmlFor="issue-amount"
                className="block text-sm font-medium text-slate-300"
              >
                {t("issueToken.amountToIssue", { asset: assetCode })}
              </label>
              <input
                id="issue-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-invalid={Boolean(amountError)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              {amountError && (
                <p className="text-xs text-red-400" role="alert">
                  {amountError}
                </p>
              )}
              <p className="text-xs text-slate-500">
                {t("issueToken.paymentMovesLead", { asset: assetCode || t("issueToken.theAsset") })}{" "}
                <span className="font-mono">{shortenAddress(issuer)}</span>{" "}
                {t("issueToken.paymentMovesTo")}{" "}
                <span className="font-mono">{shortenAddress(distributor)}</span>.
              </p>

              <button
                type="button"
                onClick={handleIssue}
                disabled={busy || Boolean(amountError)}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? t("issueToken.waitingForSignature") : t("issueToken.issueAsset", { asset: assetCode })}
              </button>

              {transactions.issue && (
                <p className="text-xs text-emerald-300">
                  {t("issueToken.issuanceTransaction")}{" "}
                  <a
                    href={explorerUrl(transactions.issue)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline underline-offset-2"
                  >
                    {transactions.issue.slice(0, 12)}…
                  </a>
                </p>
              )}
            </div>
          )}

          {/* ── Step 5: finalise ──────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label
                  htmlFor="home-domain"
                  className="block text-sm font-medium text-slate-300"
                >
                  {t("issueToken.homeDomainOptional")}
                </label>
                <div className="flex flex-wrap gap-3">
                  <input
                    id="home-domain"
                    value={homeDomain}
                    onChange={(event) => setHomeDomain(event.target.value.trim())}
                    placeholder="example.com"
                    aria-invalid={Boolean(homeDomainError)}
                    className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleSetHomeDomain}
                    disabled={busy || Boolean(homeDomainError) || !homeDomain}
                    className="btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? t("issueToken.waitingForSignature") : t("issueToken.setHomeDomain")}
                  </button>
                </div>
                {homeDomainError && (
                  <p className="text-xs text-red-400" role="alert">
                    {homeDomainError}
                  </p>
                )}
                {transactions.homeDomain && (
                  <p className="text-xs text-emerald-300">
                    {t("issueToken.homeDomainSetLabel")}{" "}
                    <a
                      href={explorerUrl(transactions.homeDomain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline underline-offset-2"
                    >
                      {transactions.homeDomain.slice(0, 12)}…
                    </a>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="font-display text-base font-semibold text-white mb-3">
                  stellar.toml
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  {t("issueToken.publishTomlLead")}{" "}
                  <span className="font-mono text-slate-300">
                    {stellarTomlUrl(homeDomain || "yourdomain.com")}
                  </span>{" "}
                  {t("issueToken.publishTomlTail")}
                </p>
                <pre className="max-h-56 overflow-auto rounded-lg bg-cosmos-900 p-3 text-[11px] leading-relaxed text-slate-300">
                  {toml}
                </pre>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" onClick={handleCopyToml} className="btn-secondary">
                    {copied ? t("issueToken.copied") : t("issueToken.copyToml")}
                  </button>
                  <a
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(toml)}`}
                    download="stellar.toml"
                    className="btn-secondary"
                  >
                    {t("issueToken.downloadToml")}
                  </a>
                </div>
              </div>

              {/* Asset summary */}
              <div className="rounded-xl border border-stellar-500/20 bg-stellar-500/5 p-4">
                <h3 className="font-display text-base font-semibold text-white mb-3">
                  {t("issueToken.assetIssued", { asset: assetCode })}
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.assetCode")}
                    </dt>
                    <dd className="font-mono text-white">{assetCode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.network")}
                    </dt>
                    <dd className="font-mono text-white">{network}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.issuer")}
                    </dt>
                    <dd className="font-mono text-white break-all">{issuer}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.distributor")}
                    </dt>
                    <dd className="font-mono text-white break-all">{distributor}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.amountIssued")}
                    </dt>
                    <dd className="font-mono text-white">
                      {formatAsset(amount, assetCode)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {t("issueToken.homeDomain")}
                    </dt>
                    <dd className="font-mono text-white">{homeDomain || "—"}</dd>
                  </div>
                </dl>

                <a
                  href={assetExplorerUrl(assetCode, issuer)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary mt-4 inline-flex"
                >
                  {t("issueToken.viewOnStellarExpert", { asset: assetCode })}
                </a>
              </div>
            </div>
          )}

          {/* ── Navigation ────────────────────────────────────────────── */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setStep((current) => (current > 1 ? ((current - 1) as StepId) : current));
              }}
              disabled={step === 1 || busy}
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("issueToken.back")}
            </button>

            {step < 5 ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setStep((current) => ((current + 1) as StepId));
                }}
                disabled={!canContinue || busy}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {t("issueToken.continue")}
              </button>
            ) : (
              <Link href="/dashboard" className="btn-primary">
                {t("issueToken.backToDashboard")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
