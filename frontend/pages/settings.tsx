/**
 * pages/settings.tsx
 * Settings page with network switcher for testnet/mainnet/custom Horizon URL.
 */

import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { getNetworkConfig, setNetworkConfig, NetworkConfig } from "@/lib/stellar";
import { apiDelete, apiGet, apiPost } from "@/lib/paymentApi";
import { disconnectWallet } from "@/lib/wallet";
import { shortenAddress } from "@/lib/stellar";
import { useWallet } from "@/lib/useWallet";
import { resetOnboardingTour } from "@/hooks/useOnboarding";
import { useTranslation } from "@/contexts/I18nContext";
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import {
  SUPPORTED_FIAT_CURRENCIES,
  getFiatCurrencyPreference,
  setFiatCurrencyPreference,
  type FiatCurrency,
} from "@/lib/price";
import WalletHealthPanel from "@/components/WalletHealthPanel";
import LeaderboardPrivacyToggle from "@/components/LeaderboardPrivacyToggle";

// Both panels are configuration-only features far down the settings page, so
// they (and the payment/anchor code behind them) load on demand (#1442).
const TurretsWizard = dynamic(() => import("@/components/TurretsWizard"), { ssr: false });
const AnchorRamp = dynamic(() => import("@/components/AnchorRamp"), { ssr: false });

export default function SettingsPage() {
  const router = useRouter();
  const { publicKey, disconnectWallet: disconnectCurrentWallet } = useWallet();
  const { t, locale, setLocale, resetLocale } = useTranslation();
  const [config, setConfig] = useState<NetworkConfig>({
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  });
  const [customUrl, setCustomUrl] = useState("");
  const [showMainnetWarning, setShowMainnetWarning] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<"testnet" | "mainnet" | "custom" | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>("USD");

  // Username registration state
  const [username, setUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);
  const [registeredUsername, setRegisteredUsername] = useState<string | null>(null);

  // Onboarding tour replay (#621)
  const [tourResetMessage, setTourResetMessage] = useState<string | null>(null);

  const handleReplayTour = () => {
    resetOnboardingTour();
    setTourResetMessage("Tour reset — it will show again next time you open the dashboard.");
  };

  // Price alert state
  const [priceAlerts, setPriceAlerts] = useState<Array<{
    id: number;
    asset: string;
    direction: 'above' | 'below';
    targetPrice: number;
    triggered: boolean;
  }>>([]);
  const [priceAlertForm, setPriceAlertForm] = useState({
    asset: 'XLM',
    direction: 'above' as 'above' | 'below',
    targetPrice: '',
  });
  const [priceAlertLoading, setPriceAlertLoading] = useState(false);
  const [priceAlertError, setPriceAlertError] = useState<string | null>(null);
  const [priceAlertSuccess, setPriceAlertSuccess] = useState<string | null>(null);

  // Fetch price alerts on mount
  useEffect(() => {
    const fetchPriceAlerts = async () => {
      if (!publicKey) return;

      try {
        const data = await apiGet<typeof priceAlerts>("/api/price-alerts", {
          query: { publicKey },
        });
        if (Array.isArray(data)) {
          setPriceAlerts(data);
        }
      } catch (err) {
        console.error("Failed to fetch price alerts:", err);
      }
    };

    fetchPriceAlerts();
  }, [publicKey]);

  // Handle price alert creation
  const handleCreatePriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    setPriceAlertLoading(true);
    setPriceAlertError(null);
    setPriceAlertSuccess(null);

    try {
      const created = await apiPost<(typeof priceAlerts)[number]>(
        "/api/price-alerts",
        {
          publicKey,
          asset: priceAlertForm.asset,
          direction: priceAlertForm.direction,
          targetPrice: parseFloat(priceAlertForm.targetPrice),
        },
        { fallbackMessage: t("settings.priceAlert.createFailed") }
      );

      setPriceAlerts([...priceAlerts, created]);
      setPriceAlertForm({ asset: "XLM", direction: "above", targetPrice: "" });
      setPriceAlertSuccess(t("settings.priceAlert.created"));
    } catch (err) {
      console.error("Failed to create price alert:", err);
      setPriceAlertError(err instanceof Error ? err.message : t("settings.priceAlert.createFailed"));
    } finally {
      setPriceAlertLoading(false);
    }
  };

  // Handle price alert deletion
  const handleDeletePriceAlert = async (id: number) => {
    try {
      await apiDelete(`/api/price-alerts/${id}`);
      setPriceAlerts(priceAlerts.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete price alert:", err);
    }
  };

  // Fetch current username on mount
  useEffect(() => {
    const fetchUsername = async () => {
      if (!publicKey) return;

      try {
        const data = await apiGet<{ username?: string }>(
          `/api/accounts/resolve/${encodeURIComponent(publicKey)}`
        );
        if (data?.username) {
          setRegisteredUsername(data.username);
        }
      } catch (err) {
        console.error("Error fetching username:", err);
      }
    };

    fetchUsername();
  }, [publicKey]);

  useEffect(() => {
    const currentConfig = getNetworkConfig();
    setConfig(currentConfig);
    if (currentConfig.network === "custom") {
      setCustomUrl(currentConfig.horizonUrl);
    }
    setFiatCurrency(getFiatCurrencyPreference());
  }, []);

  const handleCurrencyChange = (currency: FiatCurrency) => {
    setFiatCurrency(currency);
    setFiatCurrencyPreference(currency);
    // Notify same-tab listeners (e.g. dashboard) of the change.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("stellar-micropay:fiat-currency-change"));
    }
  };

  const handleNetworkChange = (network: "testnet" | "mainnet" | "custom") => {
    if (network === "mainnet" && config.network !== "mainnet") {
      setPendingNetwork(network);
      setShowMainnetWarning(true);
      return;
    }

    applyNetworkChange(network);
  };

  const applyNetworkChange = (network: "testnet" | "mainnet" | "custom") => {
    let horizonUrl: string;
    if (network === "testnet") {
      horizonUrl = "https://horizon-testnet.stellar.org";
    } else if (network === "mainnet") {
      horizonUrl = "https://horizon.stellar.org";
    } else {
      horizonUrl = customUrl.trim();
      if (!horizonUrl) return; // Don't allow empty custom URL
    }

    const newConfig: NetworkConfig = { network, horizonUrl };
    setNetworkConfig(newConfig);
    setConfig(newConfig);

    // Disconnect wallet to force reconnect on new network
    if (publicKey) {
      disconnectWallet();
      disconnectCurrentWallet();
    }

    setShowMainnetWarning(false);
    setPendingNetwork(null);
  };

  const handleCustomUrlChange = (url: string) => {
    setCustomUrl(url);
    if (config.network === "custom") {
      const newConfig: NetworkConfig = { network: "custom", horizonUrl: url };
      setNetworkConfig(newConfig);
      setConfig(newConfig);

      // Disconnect wallet on URL change
      if (publicKey) {
        disconnectWallet();
        disconnectCurrentWallet();
      }
    }
  };

  // Username registration handler
  const handleRegisterUsername = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !publicKey) {
      setUsernameError(t("settings.username.errorRequired"));
      return;
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9]{3,20}$/;
    if (!usernameRegex.test(username.trim())) {
      setUsernameError(t("settings.username.errorFormat"));
      return;
    }

    setUsernameLoading(true);
    setUsernameError(null);
    setUsernameSuccess(null);

    try {
      await apiPost(
        "/api/accounts/register",
        {
          username: username.trim().toLowerCase(),
          publicKey,
        },
        { fallbackMessage: t("settings.username.errorGeneric") }
      );

      setRegisteredUsername(username.trim().toLowerCase());
      setUsernameSuccess(
        t("settings.username.success", { username: username.trim() })
      );
      setUsername("");
    } catch (err) {
      setUsernameError(
        err instanceof Error ? err.message : t("settings.username.errorGeneric")
      );
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleClearAllData = () => {
    if (!window.confirm(t("settings.clearDataConfirm"))) return;
    Object.keys(localStorage).filter((k) => k.startsWith("stellar-micropay:")).forEach((k) => localStorage.removeItem(k));
    disconnectCurrentWallet();
    void router.push("/");
  };

  const confirmMainnetSwitch = () => {
    if (pendingNetwork) {
      applyNetworkChange(pendingNetwork);
    }
  };

  return (
    <>
      <Head>
        <title>{t("pages.settings.title")}</title>
      </Head>
      <div className="min-h-screen bg-white dark:bg-cosmos-900">
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-8">
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white mb-2">
                {t("settings.title")}
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                {t("settings.subtitle")}
              </p>
            </div>

            {/*
              Language picker — a manual choice is persisted and wins over
              browser detection on later visits; the reset button hands control
              back to detection (#1145, #1459).
            */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                {t("settings.language.title")}
              </h2>

              <label
                htmlFor="language-select"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              >
                {t("settings.language.label")}
              </label>
              <select
                id="language-select"
                value={locale}
                onChange={(event) => {
                  const next = event.target.value;
                  // `setLocale` persists the choice, which then wins over detection.
                  if (isLocale(next)) setLocale(next);
                }}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              >
                {SUPPORTED_LOCALES.map((supportedLocale) => (
                  <option key={supportedLocale} value={supportedLocale}>
                    {LOCALE_LABELS[supportedLocale]}
                  </option>
                ))}
              </select>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("settings.language.hint")}
                </p>
                <button
                  type="button"
                  onClick={resetLocale}
                  className="text-xs font-medium text-stellar-500 hover:text-stellar-400 transition-colors"
                >
                  {t("settings.language.useBrowser")}
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                {t("settings.network.title")}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t("settings.network.selectNetwork")}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleNetworkChange("testnet")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "testnet"
                          ? "border-stellar-500 bg-stellar-500/10 text-stellar-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      {t("settings.network.testnet")}
                    </button>
                    <button
                      onClick={() => handleNetworkChange("mainnet")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "mainnet"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      {t("settings.network.mainnet")}
                    </button>
                    <button
                      onClick={() => handleNetworkChange("custom")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "custom"
                          ? "border-purple-500 bg-purple-500/10 text-purple-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      {t("settings.network.custom")}
                    </button>
                  </div>
                </div>

                {config.network === "custom" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t("settings.network.customHorizonUrl")}
                    </label>
                    <input
                      type="url"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      onBlur={() => handleCustomUrlChange(customUrl)}
                      placeholder="https://horizon.example.com"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t("settings.network.customHorizonHint")}
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      {t("settings.network.current")}
                    </span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {config.horizonUrl}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Display currency (#1149) */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                {t("settings.fiat.title")}
              </h2>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t("settings.fiat.label")}
              </label>
              <div className="grid grid-cols-4 gap-3">
                {SUPPORTED_FIAT_CURRENCIES.map((currency) => (
                  <button
                    key={currency}
                    onClick={() => handleCurrencyChange(currency)}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                      fiatCurrency === currency
                        ? "border-stellar-500 bg-stellar-500/10 text-stellar-400"
                        : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {currency}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {t("settings.fiat.hint")}
              </p>
            </div>

            {/* Automation — Turrets DCA / Stop-Loss wizard (#1148) */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                {t("settings.automation.title")}
              </h2>
              <TurretsWizard />
            </div>

            {/* On/Off Ramp — SEP-0006 anchor integration (#1142) */}
            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                {t("settings.ramp.title")}
              </h2>
              <AnchorRamp />
            </div>

            {/* Username Registration Section */}
            {publicKey ? (
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-stellar-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {t("settings.username.title")}
                </h2>

                {registeredUsername ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <div>
                        <p className="text-emerald-400 font-medium">@{registeredUsername}</p>
                        <p className="text-xs text-slate-400">
                          {t("settings.username.tipPagePrefix")}{" "}
                          {typeof window !== "undefined" ? window.location.origin : ""}
                          /tip/{registeredUsername}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/tip/${registeredUsername}`}
                      className="inline-flex items-center gap-2 text-sm text-stellar-400 hover:text-stellar-300"
                    >
                      {t("settings.username.viewTipPage")}
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={handleRegisterUsername} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t("settings.username.registerLabel")}
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder={t("settings.username.placeholder")}
                            className="w-full pl-7 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                            disabled={usernameLoading}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={usernameLoading || !username.trim()}
                          className="px-4 py-2 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                          {usernameLoading
                            ? t("settings.username.registering")
                            : t("settings.username.register")}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("settings.username.hint")}
                      </p>
                    </div>

                    {usernameError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <p className="text-sm text-red-400">{usernameError}</p>
                      </div>
                    )}

                    {usernameSuccess && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                        <p className="text-sm text-emerald-400">{usernameSuccess}</p>
                      </div>
                    )}
                  </form>
                )}

                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      {t("settings.username.linkedWallet")}
                    </span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {shortenAddress(publicKey)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Price Alerts Section */}
            {publicKey ? (
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-stellar-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {t("settings.priceAlert.title")}
                </h2>

                <form onSubmit={handleCreatePriceAlert} className="space-y-4 mb-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t("settings.priceAlert.assetLabel")}
                      </label>
                      <select
                        value={priceAlertForm.asset}
                        onChange={(e) => setPriceAlertForm({ ...priceAlertForm, asset: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-cosmos-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="XLM">XLM</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t("settings.priceAlert.directionLabel")}
                      </label>
                      <select
                        value={priceAlertForm.direction}
                        onChange={(e) => setPriceAlertForm({ ...priceAlertForm, direction: e.target.value as 'above' | 'below' })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-cosmos-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="above">{t("settings.priceAlert.above")}</option>
                        <option value="below">{t("settings.priceAlert.below")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t("settings.priceAlert.targetPriceLabel")}
                      </label>
                      <input
                        type="number"
                        step="0.0000001"
                        value={priceAlertForm.targetPrice}
                        onChange={(e) => setPriceAlertForm({ ...priceAlertForm, targetPrice: e.target.value })}
                        placeholder="0.1234567"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-cosmos-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={priceAlertLoading}
                    className="btn-primary w-full"
                  >
                    {priceAlertLoading ? t("settings.priceAlert.creating") : t("settings.priceAlert.create")}
                  </button>
                </form>

                {priceAlertError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4">
                    <p className="text-sm text-red-400">{priceAlertError}</p>
                  </div>
                )}

                {priceAlertSuccess && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg mb-4">
                    <p className="text-sm text-emerald-400">{priceAlertSuccess}</p>
                  </div>
                )}

                {priceAlerts.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{t("settings.priceAlert.yourAlerts")}</h3>
                    {priceAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-cosmos-900 rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {alert.asset} {alert.direction === 'above' ? t("settings.priceAlert.above") : t("settings.priceAlert.below")} ${alert.targetPrice}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {alert.triggered ? t("settings.priceAlert.triggered") : t("settings.priceAlert.active")}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeletePriceAlert(alert.id)}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          {t("settings.priceAlert.delete")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!('Notification' in window) && (
                  <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-xs text-amber-400">
                      {t("settings.priceAlert.noNotificationSupport")}
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {publicKey ? null : (
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="text-center py-4">
                  <svg className="w-12 h-12 mx-auto text-slate-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <p className="text-slate-600 dark:text-slate-400">
                    {t("settings.username.connectPrompt")}
                  </p>
                </div>
              </div>
            )}

            {/* Wallet Health Check Section - Issue #1192 */}
            {publicKey && <WalletHealthPanel publicKey={publicKey} />}
          </div>
        </main>
      </div>

      {/* Mainnet Warning Modal */}
      {showMainnetWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t("settings.network.mainnetWarningTitle")}
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              {t("settings.network.mainnetWarningBody")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmMainnetSwitch}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {t("settings.network.switchToMainnet")}
              </button>
              <button
                onClick={() => {
                  setShowMainnetWarning(false);
                  setPendingNetwork(null);
                }}
                className="flex-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
