/**
 * lib/wallet.ts
 * Freighter wallet integration for Stellar MicroPay.
 *
 * Freighter is a browser extension wallet for Stellar.
 * Install it at: https://freighter.app
 *
 * This module wraps the @stellar/freighter-api package with
 * friendly error messages and typed return values.
 */

import {
  isConnected,
  getPublicKey,
  signTransaction,
  requestAccess,
  isAllowed,
} from "@stellar/freighter-api";

import { getNetworkPassphrase, getNetworkConfig } from "./stellar";
import { apiGet, apiPost } from "./paymentApi";
import {
  getJwtToken as getSessionJwtToken,
  setJwtToken as setSessionJwtToken,
  clearJwtToken,
} from "./auth";
import { StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { DEFAULT_LOCALE, translate } from "./i18n";

// ─── SEP-0010 helpers ────────────────────────────────────────────────────────

/**
 * Persist JWT in sessionStorage (via auth.ts). Never use localStorage for tokens.
 * The backend also sets an httpOnly `jwt` cookie on SEP-0010 verify.
 */
export function setJwtToken(token: string | null) {
  if (token) {
    setSessionJwtToken(token);
  } else {
    clearJwtToken();
  }
}

export function getJwtToken() {
  return getSessionJwtToken();
}

async function fetchAuthChallenge(publicKey: string): Promise<string> {
  const { transaction } = await apiGet<{ transaction: string }>("/api/auth", {
    query: { account: publicKey },
    credentials: "include",
    envelope: false,
    fallbackMessage: "Failed to fetch SEP-0010 challenge",
  });
  return transaction;
}

async function verifyAuthChallenge(signedXDR: string): Promise<string> {
  const { token } = await apiPost<{ token: string }>(
    "/api/auth",
    { transaction: signedXDR },
    {
      credentials: "include",
      envelope: false,
      fallbackMessage: "Auth failed",
    }
  );
  return token;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  error: string | null;
}

// ─── Browser detection ───────────────────────────────────────────────────────

export type SupportedBrowser = "chrome" | "firefox" | "other";

/**
 * Detect the user's browser to surface the correct extension store link.
 */
export function detectBrowser(): SupportedBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "firefox";
  // Chrome, Edge, Brave, Arc all include "Chrome" in UA
  if (ua.includes("Chrome")) return "chrome";
  return "other";
}

export const EXTENSION_URLS: Record<SupportedBrowser, string> = {
  chrome:
    "https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk",
  firefox:
    "https://addons.mozilla.org/en-US/firefox/addon/freighter/",
  other: "https://freighter.app",
};

// ─── Wallet detection ─────────────────────────────────────────────────────────

/**
 * Check whether the Freighter extension is installed in the browser.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const result = await isConnected();
    // isConnected returns { isConnected: boolean } or boolean depending on version
    if (typeof result === "object" && result !== null && "isConnected" in result) {
      return (result as { isConnected: boolean }).isConnected;
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Check if this site has already been granted access by the user.
 */
export async function hasSiteAccess(): Promise<boolean> {
  try {
    const result = await isAllowed();
    if (typeof result === "object" && result !== null && "isAllowed" in result) {
      return (result as { isAllowed: boolean }).isAllowed;
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

// ─── Connect / Disconnect ────────────────────────────────────────────────────

/**
 * Prompt the user to connect their Freighter wallet.
 * Returns the user's public key on success.
 */
export async function connectWallet(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  // 1. Check extension is installed
  const installed = await isFreighterInstalled();
  if (!installed) {
    return {
      publicKey: null,
      error:
        "Freighter wallet is not installed. Visit https://freighter.app to install it.",
    };
  }

  try {
    // 2. Request access from the user
    await requestAccess();

    // 3. Get the public key
    const result = await getPublicKey();
    const publicKey =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as { publicKey: string }).publicKey
        : (result as string);

    if (!publicKey) {
      return { publicKey: null, error: "No public key returned from Freighter." };
    }

    return { publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // User rejected the connection
    if (message.includes("User declined")) {
      return {
        publicKey: null,
        error: "Connection rejected. Please approve the connection in Freighter.",
      };
    }

    return { publicKey: null, error: `Wallet connection failed: ${message}` };
  }
}

/**
 * Get the currently connected public key (if any) without prompting.
 */
export async function getConnectedPublicKey(): Promise<string | null> {
  try {
    const allowed = await hasSiteAccess();
    if (!allowed) return null;

    const result = await getPublicKey();
    const pk =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as { publicKey: string }).publicKey
        : (result as string);
    return pk || null;
  } catch {
    return null;
  }
}

// ─── SEP-0010 auth flow ──────────────────────────────────────────────────────

/**
 * Full SEP-0010 authentication flow:
 * 1. Request a challenge transaction from the backend
 * 2. Sign it with the connected wallet (Freighter or Ledger)
 * 3. Submit the signed transaction to receive a JWT
 */
export async function performSEP0010Auth(
  publicKey: string,
  walletType: WalletType = "freighter"
): Promise<{
  token: string | null;
  error: string | null;
  errorCode?: LedgerErrorCode;
  errorDetail?: string;
}> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError, errorCode, errorDetail } =
      await signTransactionWithWallet(challengeXDR, walletType);
    if (signError || !signedXDR) {
      return {
        token: null,
        error: signError || "Failed to sign challenge transaction",
        errorCode,
        errorDetail,
      };
    }
    const token = await verifyAuthChallenge(signedXDR);
    setJwtToken(token);
    return { token, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: `Authentication failed: ${msg}` };
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Wallet type for signing strategy.
 */
export type WalletType = "freighter" | "ledger";

/**
 * Ask Freighter to sign a transaction XDR.
 * Returns the signed XDR string.
 */
export async function signTransactionWithWallet(
  transactionXDR: string,
  walletType: WalletType = "freighter"
): Promise<{ signedXDR: string | null; error: string | null; errorCode?: LedgerErrorCode; errorDetail?: string }> {
  if (walletType === "ledger") {
    return signTransactionWithLedger(transactionXDR);
  }

  try {
    const config = getNetworkConfig();
    const network = config.network === "mainnet" ? "MAINNET" : "TESTNET";

    const result = await signTransaction(transactionXDR, {
      networkPassphrase: getNetworkPassphrase(),
      network,
    });

    const signedXDR =
      typeof result === "object" && result !== null && "signedTransaction" in result
        ? (result as { signedTransaction: string }).signedTransaction
        : (result as string);

    return { signedXDR, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("User declined") || message.includes("rejected")) {
      return {
        signedXDR: null,
        error: "Transaction signing was rejected by the user.",
      };
    }

    return { signedXDR: null, error: `Signing failed: ${message}` };
  }
}

/**
 * Disconnect the wallet. Since Freighter doesn't provide a disconnect API,
 * this clears the local connection state. The actual disconnect happens
 * when the app's state is updated.
 */
export function disconnectWallet(): void {
  // Freighter doesn't expose an explicit disconnect API, so the app clears
  // any local auth state and lets React own the connected wallet lifecycle.
  setJwtToken(null);
}

// ─── Ledger Hardware Wallet Support ─────────────────────────────────────────────

let ledgerTransport: any = null;
let ledgerApp: any = null;

// Ledger Stellar app derivation path. @ledgerhq/hw-app-str (the published
// successor of the now-unpublished @ledgerhq/hw-app-stellar) requires an
// explicit BIP-44 path instead of defaulting to the first account.
const LEDGER_STELLAR_PATH = "44'/148'/0'";

/**
 * Distinct ways a Ledger operation can fail. Each code has a translated
 * message and recovery step under `ledgerErrors.<code>` in `locales/*.json`,
 * so the UI can tell the user *what to do* instead of showing one generic
 * "signing failed" error.
 */
export type LedgerErrorCode =
  | "deviceNotFound"
  | "locked"
  | "appNotOpen"
  | "rejected"
  | "usbPermissionDenied"
  | "timeout"
  | "unknown";

/**
 * Failures the user can fix on the device or in the browser and then simply
 * retry the same operation (unlock, open the app, reconnect, grant USB access).
 */
export const RECOVERABLE_LEDGER_ERRORS: readonly LedgerErrorCode[] = [
  "deviceNotFound",
  "locked",
  "appNotOpen",
  "rejected",
  "usbPermissionDenied",
  "timeout",
];

export function isRecoverableLedgerError(code: LedgerErrorCode | null | undefined): boolean {
  return !!code && RECOVERABLE_LEDGER_ERRORS.includes(code);
}

// APDU status words returned by the device (see @ledgerhq/errors StatusCodes).
const LEDGER_STATUS_LOCKED = [0x5515, 0x6b0c];
const LEDGER_STATUS_APP_NOT_OPEN = [0x6511, 0x6d00, 0x6e00, 0x6e01, 0x6807];
const LEDGER_STATUS_REJECTED = [0x6985, 0x6986];

/**
 * Map a transport/app error from @ledgerhq/* (or the browser's WebUSB API) to
 * a {@link LedgerErrorCode}. Checks the APDU status code first, then the error
 * class name, then falls back to message matching for older library versions.
 */
export function classifyLedgerError(err: unknown): LedgerErrorCode {
  const { statusCode, name = "", message = "" } =
    typeof err === "object" && err !== null
      ? (err as { statusCode?: number; name?: string; message?: string })
      : { message: String(err) };
  const text = `${name} ${message}`.toLowerCase();

  if (typeof statusCode === "number") {
    if (LEDGER_STATUS_LOCKED.includes(statusCode)) return "locked";
    if (LEDGER_STATUS_APP_NOT_OPEN.includes(statusCode)) return "appNotOpen";
    if (LEDGER_STATUS_REJECTED.includes(statusCode)) return "rejected";
  }

  if (name === "LockedDeviceError" || text.includes("locked")) return "locked";
  if (text.includes("app is not open") || text.includes("app not open")) return "appNotOpen";
  if (text.includes("rejected") || text.includes("denied by the user")) return "rejected";
  if (
    name === "TimeoutError" ||
    text.includes("timeout") ||
    text.includes("timed out")
  ) {
    return "timeout";
  }
  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    name === "TransportOpenUserCancelled" ||
    name === "TransportWebUSBGestureRequired" ||
    name === "TransportInterfaceNotAvailable" ||
    text.includes("access denied") ||
    text.includes("unable to claim interface") ||
    text.includes("permission")
  ) {
    return "usbPermissionDenied";
  }
  if (
    name === "DisconnectedDevice" ||
    name === "DisconnectedDeviceDuringOperation" ||
    text.includes("no device") ||
    text.includes("disconnected")
  ) {
    return "deviceNotFound";
  }

  return "unknown";
}

/**
 * Build the error fields of a failed Ledger result: the code, the raw error
 * text (`errorDetail`), and an English message for callers outside React.
 * Components should render `ledgerErrors.<code>` in the active locale instead.
 */
function ledgerFailure(err: unknown): {
  error: string;
  errorCode: LedgerErrorCode;
  errorDetail: string;
} {
  const errorCode = classifyLedgerError(err);
  const errorDetail = err instanceof Error ? err.message : String(err);
  const error = translate(DEFAULT_LOCALE, `ledgerErrors.${errorCode}.message`, {
    detail: errorDetail,
  });
  return { error, errorCode, errorDetail };
}

async function closeLedgerTransport(): Promise<void> {
  if (ledgerTransport) {
    try {
      await ledgerTransport.close();
    } catch {
      // Ignore close errors
    }
  }
  ledgerTransport = null;
  ledgerApp = null;
}

async function openLedgerApp(): Promise<any> {
  const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
  const AppStellar = (await import("@ledgerhq/hw-app-str")).default;

  ledgerTransport = await TransportWebUSB.create();
  ledgerApp = new AppStellar(ledgerTransport);
  return ledgerApp;
}

/**
 * Check if Ledger hardware wallet is supported (WebUSB available).
 */
export const isLedgerSupported = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  if (!navigator || !(navigator as any).usb) return false;
  
  try {
    // Dynamic import to avoid SSR issues
    const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
    return TransportWebUSB.isSupported();
  } catch {
    return false;
  }
};

/**
 * Get public key from Ledger device.
 */
export async function getLedgerPublicKey(): Promise<{
  publicKey: string | null;
  error: string | null;
  errorCode?: LedgerErrorCode;
  errorDetail?: string;
}> {
  try {
    const app = await openLedgerApp();
    const result = await app.getPublicKey(LEDGER_STELLAR_PATH, true);
    // hw-app-str returns the raw 32-byte ed25519 key; Stellar addresses are its
    // StrKey (G...) encoding, which is what the rest of the app expects.
    const publicKey = StrKey.encodeEd25519PublicKey(result.rawPublicKey);

    return { publicKey, error: null };
  } catch (err: unknown) {
    return { publicKey: null, ...ledgerFailure(err) };
  } finally {
    await closeLedgerTransport();
  }
}

/**
 * Sign transaction with Ledger device.
 */
export async function signTransactionWithLedger(xdr: string): Promise<{
  signedXDR: string | null;
  error: string | null;
  errorCode?: LedgerErrorCode;
  errorDetail?: string;
}> {
  try {
    const app = await openLedgerApp();
    // hw-app-str signs the transaction signature base (a Buffer), not the raw
    // XDR envelope the rest of this module passes around, and returns only the
    // detached signature — attach it so callers get a submittable envelope.
    const tx = TransactionBuilder.fromXDR(xdr, getNetworkPassphrase());
    const { rawPublicKey } = await app.getPublicKey(LEDGER_STELLAR_PATH, false);
    const result = await app.signTransaction(LEDGER_STELLAR_PATH, tx.signatureBase());
    tx.addSignature(
      StrKey.encodeEd25519PublicKey(rawPublicKey),
      result.signature.toString("base64")
    );
    const signedXDR = tx.toXDR();

    return { signedXDR, error: null };
  } catch (err: unknown) {
    return { signedXDR: null, ...ledgerFailure(err) };
  } finally {
    await closeLedgerTransport();
  }
}
