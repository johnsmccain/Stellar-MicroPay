/**
 * __tests__/validateEnv.test.js
 * Unit tests for src/validateEnv.js
 */

"use strict";

const { validateEnv, REQUIRED_VARS } = require("../src/validateEnv");
const { getConfig } = require("../src/config/env");

describe("validateEnv", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("exports production-required secret names", () => {
    expect(REQUIRED_VARS).toEqual(
      expect.arrayContaining(["JWT_SECRET", "SERVER_PRIVATE_KEY", "PAYMENT_SIGNING_SECRET"])
    );
    expect(REQUIRED_VARS).toHaveLength(3);
  });

  it("accepts defaulted development configuration", () => {
    const errors = validateEnv({}, { exitOnFailure: false });

    expect(errors).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("centralizes network and optional integration defaults", () => {
    const config = getConfig({});

    expect(config.network).toBe("testnet");
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.port).toBe(4000);
    expect(config.turretsPort).toBe(4100);
    expect(config.redisUrl).toBeNull();
    expect(config.contractId).toBe("");
    expect(config.logLevel).toBe("info");
  });

  it("resolves supported legacy aliases and network-specific defaults", () => {
    const config = getConfig({
      STELLAR_NETWORK: "mainnet",
      STELLAR_HORIZON_URL: "https://custom-horizon.example",
      SOROBAN_CONTRACT_ID: "contract-from-alias",
      EVENT_POLL_INTERVAL_MS: "9000",
      DOMAIN: "payments.example",
    });

    expect(config.horizonUrl).toBe("https://custom-horizon.example");
    expect(config.sorobanRpcUrl).toBe("https://soroban.stellar.org");
    expect(config.contractId).toBe("contract-from-alias");
    expect(config.eventPollIntervalMs).toBe(9000);
    expect(config.homeDomain).toBe("payments.example");
  });

  it("requires all signing secrets in production", () => {
    const errors = validateEnv({ NODE_ENV: "production" }, { exitOnFailure: false });

    expect(errors).toHaveLength(3);
    expect(errors.join(" ")).toContain("JWT_SECRET");
    expect(errors.join(" ")).toContain("SERVER_PRIVATE_KEY");
    expect(errors.join(" ")).toContain("PAYMENT_SIGNING_SECRET");
  });

  it("returns no errors when all production secrets are present", () => {
    const env = {
      JWT_SECRET: "supersecret",
      SERVER_PRIVATE_KEY: "Ssecret",
      PAYMENT_SIGNING_SECRET: "payment-secret",
      NODE_ENV: "production",
    };

    const errors = validateEnv(env, { exitOnFailure: false });

    expect(errors).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("reports malformed network, URLs, and numeric settings", () => {
    const errors = validateEnv({
      STELLAR_NETWORK: "unknown",
      HORIZON_URL: "not-a-url",
      PORT: "70000",
      EVENTS_POLL_INTERVAL_MS: "0",
    }, { exitOnFailure: false });

    expect(errors.join(" ")).toContain("STELLAR_NETWORK");
    expect(errors.join(" ")).toContain("HORIZON_URL");
    expect(errors.join(" ")).toContain("PORT");
    expect(errors.join(" ")).toContain("EVENTS_POLL_INTERVAL_MS");
  });

  it("rejects incomplete VAPID pairs and invalid log levels", () => {
    const errors = validateEnv({ VAPID_PUBLIC_KEY: "public", LOG_LEVEL: "verbose" }, {
      exitOnFailure: false,
    });

    expect(errors.join(" ")).toContain("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");
    expect(errors.join(" ")).toContain("LOG_LEVEL");
  });

  it("rejects a malformed optional Turrets signer address", () => {
    const errors = validateEnv({ TURRETS_SIGNER_ADDRESS: "not-a-stellar-public-key" }, {
      exitOnFailure: false,
    });

    expect(errors.join(" ")).toContain("TURRETS_SIGNER_ADDRESS");
  });

  it("rejects a malformed production server private key", () => {
    const errors = validateEnv({
      NODE_ENV: "production",
      JWT_SECRET: "jwt-secret",
      SERVER_PRIVATE_KEY: "not-a-stellar-secret",
      PAYMENT_SIGNING_SECRET: "payment-secret",
    }, { exitOnFailure: false });

    expect(errors.join(" ")).toContain("SERVER_PRIVATE_KEY must be a Stellar secret key");
  });

  it("rejects example placeholder secrets in production", () => {
    const errors = validateEnv({
      NODE_ENV: "production",
      JWT_SECRET: "your_jwt_secret_here",
      SERVER_PRIVATE_KEY: "Svalid-prefix",
      PAYMENT_SIGNING_SECRET: "your_payment_signing_secret_here",
    }, { exitOnFailure: false });

    expect(errors.join(" ")).toContain("JWT_SECRET is required in production");
    expect(errors.join(" ")).toContain("PAYMENT_SIGNING_SECRET is required in production");
  });

  it("calls process.exit(1) when exitOnFailure is true and vars are missing", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    const env = { NODE_ENV: "production" };

    validateEnv(env, { exitOnFailure: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("does not call process.exit when all vars are present", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    const env = {
      NODE_ENV: "production",
      JWT_SECRET: "s3cr3t",
      SERVER_PRIVATE_KEY: "Ssecret",
      PAYMENT_SIGNING_SECRET: "payment-secret",
    };

    validateEnv(env, { exitOnFailure: true });

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("treats empty production secrets as missing", () => {
    const env = {
      NODE_ENV: "production",
      JWT_SECRET: "",
      SERVER_PRIVATE_KEY: "Ssecret",
      PAYMENT_SIGNING_SECRET: "payment-secret",
    };

    const errors = validateEnv(env, { exitOnFailure: false });

    expect(errors.join(" ")).toContain("JWT_SECRET");
  });
});
