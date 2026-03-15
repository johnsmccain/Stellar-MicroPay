/**
 * lib/stellar.ts
 * Core Stellar blockchain interaction helpers.
 * Uses the Horizon REST API — no private keys ever touch the backend.
 */

import {
  Horizon,
  Transaction,
  Networks,
  Asset,
  Operation,
  TransactionBuilder,
  Memo,
} from "@stellar/stellar-sdk";

// ─── Config ────────────────────────────────────────────────────────────────

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as
  | "testnet"
  | "mainnet";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export const server = new Horizon.Server(HORIZON_URL);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WalletBalance {
  asset: string;
  balance: string;
  assetCode: string;
}

export interface PaymentRecord {
  id: string;
  type: "sent" | "received";
  amount: string;
  asset: string;
  from: string;
  to: string;
  memo?: string;
  createdAt: string;
  transactionHash: string;
}

// ─── Account helpers ────────────────────────────────────────────────────────

/**
 * Fetch all balances for a Stellar account.
 */
export async function getBalances(publicKey: string): Promise<WalletBalance[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.map((b) => {
      if (b.asset_type === "native") {
        return { asset: "native", balance: b.balance, assetCode: "XLM" };
      }
      const typed = b as Horizon.HorizonApi.BalanceLineAsset;
      return {
        asset: `${typed.asset_code}:${typed.asset_issuer}`,
        balance: typed.balance,
        assetCode: typed.asset_code,
      };
    });
  } catch (err) {
    console.error("Failed to load account balances:", err);
    throw new Error("Could not fetch account. Is this address funded?");
  }
}

/**
 * Fetch the native XLM balance for an account.
 */
export async function getXLMBalance(publicKey: string): Promise<string> {
  const balances = await getBalances(publicKey);
  const xlm = balances.find((b) => b.assetCode === "XLM");
  return xlm ? xlm.balance : "0";
}

// ─── Transaction helpers ─────────────────────────────────────────────────────

/**
 * Build an unsigned XLM payment transaction.
 * The caller (Freighter) will sign it.
 */
export async function buildPaymentTransaction({
  fromPublicKey,
  toPublicKey,
  amount,
  memo,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100", // 100 stroops = 0.00001 XLM
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: toPublicKey,
        asset: Asset.native(),
        amount: amount,
      })
    )
    .setTimeout(60); // 60 second validity window

  if (memo) {
    builder.addMemo(Memo.text(memo.slice(0, 28))); // Stellar memo max 28 bytes
  }

  return builder.build();
}

/**
 * Submit a signed transaction XDR to the Stellar network.
 */
export async function submitTransaction(signedXDR: string) {
  const transaction = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (err: unknown) {
    const horizonErr = err as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    if (horizonErr?.response?.data?.extras?.result_codes) {
      const codes = horizonErr.response.data.extras.result_codes;
      throw new Error(`Transaction failed: ${JSON.stringify(codes)}`);
    }
    throw err;
  }
}

// ─── Payment history ─────────────────────────────────────────────────────────

/**
 * Fetch recent payment operations for an account.
 */
export async function getPaymentHistory(
  publicKey: string,
  limit = 20
): Promise<PaymentRecord[]> {
  const payments = await server
    .payments()
    .forAccount(publicKey)
    .limit(limit)
    .order("desc")
    .call();

  const records: PaymentRecord[] = [];

  for (const op of payments.records) {
    // Only process payment operations
    if (op.type !== "payment") continue;

    const payment = op as Horizon.HorizonApi.PaymentOperationResponse;

    // Fetch transaction for memo
    let memo: string | undefined;
    try {
      const tx = await server.transactions().transaction(payment.transaction_hash).call();
      if (tx.memo && tx.memo_type === "text") {
        memo = tx.memo;
      }
    } catch {
      // memo is optional, don't fail
    }

    const assetCode =
      payment.asset_type === "native" ? "XLM" : payment.asset_code || "???";

    records.push({
      id: payment.id,
      type: payment.from === publicKey ? "sent" : "received",
      amount: payment.amount,
      asset: assetCode,
      from: payment.from,
      to: payment.to,
      memo,
      createdAt: payment.created_at,
      transactionHash: payment.transaction_hash,
    });
  }

  return records;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Shorten a Stellar address for display: GABC...XYZ
 */
export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Validate a Stellar public key format.
 */
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

/**
 * Format a transaction URL for Stellar Expert explorer.
 */
export function explorerUrl(hash: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}
