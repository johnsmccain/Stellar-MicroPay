/**
 * src/validateEnv.js
 * Startup validation for backend environment configuration.
 * Call this after dotenv and before loading routes or services.
 */

"use strict";

const { getConfig } = require("./config/env");
const fs = require("fs");
const REQUIRED_VARS = ["JWT_SECRET", "SERVER_PRIVATE_KEY", "PAYMENT_SIGNING_SECRET"];

function readSecretFile(filePath) {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function getSecret(varName, env = process.env) {
  const plainValue = env[varName]?.trim();
  if (plainValue) return plainValue;
  const filePath = env[`${varName}_FILE`];
  return filePath ? readSecretFile(filePath) : null;
}

function isPlaceholderSecret(value) {
  return /^(your_|change[-_ ]?me|replace[-_ ]?me)/i.test(value);
}

function loadSecrets(env = process.env) {
  for (const varName of REQUIRED_VARS) {
    const value = getSecret(varName, env);
    if (value && !env[varName]) env[varName] = value;
  }
}

function collectErrors(env = process.env) {
  const errors = [];
  const config = getConfig(env);

  if (config.nodeEnv !== "development" && config.nodeEnv !== "test" && config.nodeEnv !== "production") {
    errors.push("NODE_ENV must be one of development, test, or production.");
  }
  if (config.network !== "testnet" && config.network !== "mainnet") {
    errors.push("STELLAR_NETWORK must be either testnet or mainnet.");
  }
  if (!new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).has(config.logLevel)) {
    errors.push("LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, or silent.");
  }

  for (const [name, value] of [["HORIZON_URL", config.horizonUrl], ["SOROBAN_RPC_URL", config.sorobanRpcUrl]]) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    } catch {
      errors.push(`${name} must be a valid HTTP(S) URL.`);
    }
  }

  const numericValues = [
    ["PORT", env.PORT, 1, 65535],
    ["TURRETS_PORT", env.TURRETS_PORT, 1, 65535],
    ["EVENTS_POLL_INTERVAL_MS / EVENT_POLL_INTERVAL_MS", env.EVENTS_POLL_INTERVAL_MS || env.EVENT_POLL_INTERVAL_MS, 1, Number.MAX_SAFE_INTEGER],
    ["EVENTS_HEARTBEAT_INTERVAL_MS", env.EVENTS_HEARTBEAT_INTERVAL_MS, 1, Number.MAX_SAFE_INTEGER],
    ["EVENTS_LEDGER_LOOKBACK", env.EVENTS_LEDGER_LOOKBACK, 1, Number.MAX_SAFE_INTEGER],
    ["TURRETS_EVALUATION_INTERVAL_MS", env.TURRETS_EVALUATION_INTERVAL_MS, 1, Number.MAX_SAFE_INTEGER],
    ["ANALYTICS_CACHE_TTL_MS", env.ANALYTICS_CACHE_TTL_MS, 1, Number.MAX_SAFE_INTEGER],
    ["ANALYTICS_CACHE_MAX_ENTRIES", env.ANALYTICS_CACHE_MAX_ENTRIES, 1, Number.MAX_SAFE_INTEGER],
  ];
  for (const [name, rawValue, min, max] of numericValues) {
    if (rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${name} must be an integer between ${min} and ${max}.`);
    }
  }

  if (env.REDIS_URL) {
    try {
      const url = new URL(env.REDIS_URL);
      if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("unsupported protocol");
    } catch {
      errors.push("REDIS_URL must be a valid redis:// or rediss:// URL when set.");
    }
  }

  if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
    errors.push("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together to enable web push.");
  }
  if (env.TURRETS_SIGNER_ADDRESS && !/^G[A-Z0-9]{55}$/.test(env.TURRETS_SIGNER_ADDRESS)) {
    errors.push("TURRETS_SIGNER_ADDRESS must be a valid Stellar public key beginning with G.");
  }
  if (env.VAPID_CONTACT && !/^(mailto:|https:\/\/)/i.test(env.VAPID_CONTACT)) {
    errors.push("VAPID_CONTACT must be a mailto: or https:// contact URI.");
  }

  if (config.nodeEnv === "production") {
    const descriptions = {
      JWT_SECRET: "Used to sign authentication tokens. Generate with: openssl rand -base64 32",
      SERVER_PRIVATE_KEY: "The Stellar account private key used to sign payment transactions; it must start with S.",
      PAYMENT_SIGNING_SECRET: "Used to verify signed payment submissions. Generate with: openssl rand -hex 32",
    };
    for (const name of REQUIRED_VARS) {
      const secret = getSecret(name, env);
      if (!secret || isPlaceholderSecret(secret)) {
        errors.push(`${name} is required in production — set ${name} or ${name}_FILE. ${descriptions[name]}`);
      }
    }
    const serverPrivateKey = getSecret("SERVER_PRIVATE_KEY", env);
    if (serverPrivateKey && !serverPrivateKey.startsWith("S")) {
      errors.push("SERVER_PRIVATE_KEY must be a Stellar secret key beginning with S.");
    }
  }

  return errors;
}

/**
 * Validates required secrets and configured values before services are loaded.
 * Logs actionable errors and exits with code 1 when validation fails.
 *
 * @param {NodeJS.ProcessEnv} env - The environment object (defaults to process.env)
 * @param {object} [options]
 * @param {boolean} [options.exitOnFailure=true] - Whether to call process.exit(1) on failure
 * @returns {string[]} Array of validation errors (empty when valid)
 */
function validateEnv(env = process.env, { exitOnFailure = true } = {}) {
  loadSecrets(env);
  const errors = collectErrors(env);
  if (errors.length > 0) {
    console.error("\nEnvironment validation failed:\n");
    for (const message of errors) console.error(`  - ${message}`);
    console.error("");
    if (exitOnFailure) process.exit(1);
  }
  return errors;
}

module.exports = {
  validateEnv,
  collectErrors,
  REQUIRED_VARS,
  loadSecrets,
  getSecret,
  readSecretFile,
};
