"use strict";

const path = require("path");
let ephemeralServerPrivateKey;

const DEFAULTS = Object.freeze({
  nodeEnv: "development",
  network: "testnet",
  port: 4000,
  turretsPort: 4100,
  horizonTestnetUrl: "https://horizon-testnet.stellar.org",
  horizonMainnetUrl: "https://horizon.stellar.org",
  sorobanTestnetUrl: "https://soroban-testnet.stellar.org",
  sorobanMainnetUrl: "https://soroban.stellar.org",
  usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  domain: "stellarmicropay.com",
  homeDomain: "localhost:4000",
  allowedOrigins: "http://localhost:3000",
  jwtSecret: "test-secret-key-for-jest-tests-only-not-for-production",
  paymentSigningSecret: "stellar_micropay_request_signing_key",
  csrfSecret: "default-csrf-secret",
  logLevel: "info",
  testLogLevel: "silent",
  vapidContact: "mailto:admin@stellarmicropay.com",
  eventsPollIntervalMs: 5000,
  eventsHeartbeatIntervalMs: 15000,
  eventsLedgerLookback: 20,
  turretsEvaluationIntervalMs: 30000,
  analyticsCacheTtlMs: 300000,
  analyticsCacheMaxEntries: 500,
});

function getConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || DEFAULTS.nodeEnv;
  const network = env.STELLAR_NETWORK || DEFAULTS.network;
  const horizonUrl = env.HORIZON_URL || env.STELLAR_HORIZON_URL ||
    (network === "mainnet" ? DEFAULTS.horizonMainnetUrl : DEFAULTS.horizonTestnetUrl);
  const jwtSecret = env.JWT_SECRET || (nodeEnv === "production" ? "" : DEFAULTS.jwtSecret);
  const paymentSigningSecret = env.PAYMENT_SIGNING_SECRET ||
    (nodeEnv === "production" ? "" : DEFAULTS.paymentSigningSecret);

  return {
    nodeEnv,
    network,
    port: Number(env.PORT || DEFAULTS.port),
    allowedOrigins: env.ALLOWED_ORIGINS || DEFAULTS.allowedOrigins,
    horizonUrl,
    sorobanRpcUrl: env.SOROBAN_RPC_URL ||
      (network === "mainnet" ? DEFAULTS.sorobanMainnetUrl : DEFAULTS.sorobanTestnetUrl),
    contractId: env.CONTRACT_ID || env.SOROBAN_CONTRACT_ID || env.NEXT_PUBLIC_CONTRACT_ID || "",
    eventPollIntervalMs: Number(
      env.EVENTS_POLL_INTERVAL_MS || env.EVENT_POLL_INTERVAL_MS || DEFAULTS.eventsPollIntervalMs,
    ),
    eventsHeartbeatIntervalMs: Number(
      env.EVENTS_HEARTBEAT_INTERVAL_MS || DEFAULTS.eventsHeartbeatIntervalMs,
    ),
    eventsLedgerLookback: Number(env.EVENTS_LEDGER_LOOKBACK || DEFAULTS.eventsLedgerLookback),
    domain: env.DOMAIN || DEFAULTS.domain,
    homeDomain: env.HOME_DOMAIN || env.DOMAIN || DEFAULTS.homeDomain,
    networkPassphrase: network === "mainnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015",
    serverPrivateKey: env.SERVER_PRIVATE_KEY || "",
    jwtSecret,
    paymentSigningSecret,
    csrfSecret: env.CSRF_SECRET || jwtSecret || DEFAULTS.csrfSecret,
    adminPublicKeys: env.ADMIN_PUBLIC_KEYS || "",
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    metricsEnabled: env.METRICS_ENABLED === "true",
    turretsPort: Number(env.TURRETS_PORT || DEFAULTS.turretsPort),
    turretsSignerAddress: env.TURRETS_SIGNER_ADDRESS || "",
    turretsEvaluationIntervalMs: Number(
      env.TURRETS_EVALUATION_INTERVAL_MS || DEFAULTS.turretsEvaluationIntervalMs,
    ),
    usdcIssuer: env.USDC_ISSUER || DEFAULTS.usdcIssuer,
    vapidContact: env.VAPID_CONTACT || DEFAULTS.vapidContact,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || "",
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || "",
    redisUrl: env.REDIS_URL || null,
    analyticsCacheTtlMs: Number(env.ANALYTICS_CACHE_TTL_MS || DEFAULTS.analyticsCacheTtlMs),
    analyticsCacheMaxEntries: Number(
      env.ANALYTICS_CACHE_MAX_ENTRIES || DEFAULTS.analyticsCacheMaxEntries,
    ),
    scheduledTxDataFile: env.SCHEDULED_TX_DATA_FILE ||
      path.resolve(__dirname, "../../data/scheduled_transactions.json"),
    leaderboardOptOutDataFile: env.LEADERBOARD_OPTOUT_DATA_FILE ||
      path.resolve(__dirname, "../../data/leaderboard-opt-out.json"),
    usernamesDataFile: env.USERNAMES_DATA_FILE ||
      path.resolve(__dirname, "../../data/usernames.json"),
    logLevel: env.LOG_LEVEL || (nodeEnv === "test" ? DEFAULTS.testLogLevel : DEFAULTS.logLevel),
  };
}

function getServerPrivateKey(env = process.env) {
  const config = getConfig(env);
  if (config.serverPrivateKey || config.nodeEnv === "production") return config.serverPrivateKey;
  if (!ephemeralServerPrivateKey) {
    const { Keypair } = require("@stellar/stellar-sdk");
    ephemeralServerPrivateKey = Keypair.random().secret();
  }
  return ephemeralServerPrivateKey;
}

module.exports = { DEFAULTS, getConfig, getServerPrivateKey };