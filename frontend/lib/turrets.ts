/**
 * lib/turrets.ts
 * Frontend API helpers for Turrets txFunctions.
 */

import { apiRequest, type ApiRequestOptions } from "./paymentApi";

export type TurretsType = "dca" | "stop_loss";

export type ScheduledFrequency = "daily" | "weekly" | "monthly";

export interface TurretsDeployment {
  id: string;
  ownerPublicKey: string;
  type: TurretsType;
  status: "active" | "paused";
  config: Record<string, unknown>;
  deploymentHash: string;
  createdAt: string;
  nextRunAt: string | null;
  lastExecutedAt: string | null;
  lastCheckedAt: string | null;
  lastObservedPriceUsd: number | null;
  lastError: string | null;
}

export interface TurretsExecutionHistory {
  id: string;
  deploymentId: string;
  status: string;
  message: string;
  result: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Every Turrets endpoint answers with the backend's `{ success, data }`
 * envelope, so the gateway unwraps it and `ApiError.message` carries the
 * server's own `error` text.
 */
function turretsRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  return apiRequest<T>(path, {
    fallbackMessage: "Turrets API request failed",
    ...options,
  });
}

export async function createTurretsChallenge(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
}) {
  return turretsRequest<{
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  }>("/api/turrets/challenge", { method: "POST", body: params });
}

export async function deployTurretsFunction(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
  deploymentHash: string;
  signedChallengeXDR: string;
}) {
  return turretsRequest<TurretsDeployment>("/api/turrets/deploy", {
    method: "POST",
    body: params,
  });
}

/** Create a scheduled recurring payment via POST /api/turrets/dca */
export async function createScheduledDcaPayment(params: {
  ownerPublicKey: string;
  recipient: string;
  amount: string | number;
  asset: "XLM" | "USDC" | string;
  assetIssuer?: string | null;
  frequency: ScheduledFrequency;
}) {
  return turretsRequest<TurretsDeployment>("/api/turrets/dca", {
    method: "POST",
    body: params,
  });
}

export async function listTurretsFunctions(ownerPublicKey: string) {
  return turretsRequest<TurretsDeployment[]>("/api/turrets", {
    query: { ownerPublicKey },
  });
}

export interface TurretsDcaRequest {
  ownerPublicKey: string;
  intervalMinutes: number;
  amountQuote: number;
  quoteAssetCode?: string;
  quoteAssetIssuer?: string | null;
}

export interface TurretsStopLossRequest {
  ownerPublicKey: string;
  thresholdPrice: number;
  amountSell: number;
  sellAssetCode?: string;
  sellAssetIssuer?: string | null;
  cooldownMinutes?: number;
}

export interface TurretsAutomationResponse extends TurretsDeployment {
  turretSignerAddress: string;
}

export async function createDcaAutomation(params: TurretsDcaRequest) {
  return turretsRequest<TurretsAutomationResponse>("/api/turrets/dca", {
    method: "POST",
    body: params,
  });
}

export async function createStopLossAutomation(params: TurretsStopLossRequest) {
  return turretsRequest<TurretsAutomationResponse>("/api/turrets/stop-loss", {
    method: "POST",
    body: params,
  });
}

export async function getTurretSignerAddress(): Promise<string> {
  const data = await turretsRequest<{ turretSignerAddress: string }>(
    "/api/turrets/signer"
  );
  return data.turretSignerAddress;
}

export async function getTurretsHistory(id: string) {
  return turretsRequest<TurretsExecutionHistory[]>(
    `/api/turrets/${encodeURIComponent(id)}/history`
  );
}

export async function pauseTurretsFunction(id: string) {
  return turretsRequest<TurretsDeployment>(
    `/api/turrets/${encodeURIComponent(id)}/pause`,
    { method: "PATCH" }
  );
}

export async function resumeTurretsFunction(id: string) {
  return turretsRequest<TurretsDeployment>(
    `/api/turrets/${encodeURIComponent(id)}/resume`,
    { method: "POST" }
  );
}

export async function cancelTurretsFunction(id: string) {
  return turretsRequest<{ id: string; status: string; cancelledAt: string }>(
    `/api/turrets/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}
