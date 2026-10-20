/**
 * mock-horizon/__tests__/mockHorizonFailureInjection.test.js
 * End-to-end integration test demonstrating mock Horizon failure injection
 * (latency, error-rate injection 504/429, rate-limit headers, and submission result codes).
 *
 * Issue #1419
 */

"use strict";

const request = require("supertest");
const { createMockHorizonApp } = require("../server");

describe("Mock Horizon Failure Injection End-to-End (#1419)", () => {
  let app;

  beforeEach(() => {
    app = createMockHorizonApp();
  });

  afterEach(async () => {
    await request(app).post("/_control/reset");
  });

  describe("Control endpoint (/_control)", () => {
    it("reports default configuration via GET /_control", async () => {
      const res = await request(app).get("/_control").expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.config).toMatchObject({
        latencyMs: 0,
        errorRate: 0,
        errorStatus: 504,
        submitResultCode: null,
      });
    });

    it("dynamically updates configuration via POST /_control", async () => {
      const updatePayload = {
        latencyMs: 50,
        errorRate: 0.5,
        errorStatus: 504,
        submitResultCode: "tx_bad_seq",
      };

      const res = await request(app)
        .post("/_control")
        .send(updatePayload)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.config).toMatchObject(updatePayload);
    });

    it("resets configuration via POST /_control/reset", async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, submitResultCode: "op_underfunded" })
        .expect(200);

      const resetRes = await request(app).post("/_control/reset").expect(200);

      expect(resetRes.body.success).toBe(true);
      expect(resetRes.body.config.errorRate).toBe(0);
      expect(resetRes.body.config.submitResultCode).toBeNull();
    });
  });

  describe("Artificial latency injection", () => {
    it("delays responses by configured latencyMs", async () => {
      const latencyMs = 80;
      await request(app).post("/_control").send({ latencyMs }).expect(200);

      const start = Date.now();
      const res = await request(app).get("/accounts/G_TEST_ACCOUNT_123").expect(200);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(70);
      expect(res.body.account_id).toBe("G_TEST_ACCOUNT_123");
    });
  });

  describe("Error-rate injection (504 & 429)", () => {
    it("injects 504 Gateway Timeout when errorRate is 1.0", async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, errorStatus: 504 })
        .expect(200);

      const res = await request(app).get("/accounts/G_TEST_ACCOUNT_123").expect(504);

      expect(res.body).toMatchObject({
        type: "https://stellar.org/horizon-errors/timeout",
        title: "Gateway Timeout",
        status: 504,
      });
    });

    it("injects 429 Rate Limit Exceeded with custom rate-limit headers", async () => {
      await request(app)
        .post("/_control")
        .send({
          errorRate: 1.0,
          errorStatus: 429,
          rateLimitLimit: 100,
          rateLimitRemaining: 0,
          rateLimitReset: 30,
        })
        .expect(200);

      const res = await request(app).get("/accounts/G_TEST_ACCOUNT_123").expect(429);

      expect(res.body).toMatchObject({
        type: "https://stellar.org/horizon-errors/rate_limit_exceeded",
        title: "Rate Limit Exceeded",
        status: 429,
      });

      expect(res.headers["x-ratelimit-limit"]).toBe("100");
      expect(res.headers["x-ratelimit-remaining"]).toBe("0");
      expect(res.headers["x-ratelimit-reset"]).toBe("30");
    });
  });

  describe("Transaction submission failure injection", () => {
    it("returns tx_bad_seq error on POST /transactions when configured", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "tx_bad_seq" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expect(res.body).toMatchObject({
        type: "https://stellar.org/horizon-errors/transaction_failed",
        title: "Transaction Failed",
        status: 400,
        extras: {
          result_codes: {
            transaction: "tx_bad_seq",
          },
        },
      });
    });

    it("returns op_underfunded error on POST /transactions when configured", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "op_underfunded" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expect(res.body).toMatchObject({
        type: "https://stellar.org/horizon-errors/transaction_failed",
        title: "Transaction Failed",
        status: 400,
        extras: {
          result_codes: {
            transaction: "tx_failed",
            operations: ["op_underfunded"],
          },
        },
      });
    });

    it("returns 200 OK on POST /transactions when no failure code is configured", async () => {
      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_VALID_TX_ENVELOPE_XDR" })
        .expect(200);

      expect(res.body).toMatchObject({
        hash: expect.any(String),
        ledger: 12345,
        envelope_xdr: "AAAA_VALID_TX_ENVELOPE_XDR",
      });
    });
  });
});
