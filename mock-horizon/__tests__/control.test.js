/**
 * mock-horizon/__tests__/control.test.js
 * The runtime control endpoint (`/_control`) and the failure injection it
 * drives.
 *
 * Tests use the HTTP control endpoint rather than the helper methods on the
 * app, because that is how the integration tests toggle the mock: a request
 * has to be able to change the configuration of a server that is already
 * running.
 *
 * Issue #1420
 */

"use strict";

const request = require("supertest");
const { createMockHorizonApp } = require("../server");

const ACCOUNT_ID =
  "GB7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("mock-horizon runtime control (#1420)", () => {
  let app;

  beforeEach(() => {
    app = createMockHorizonApp();
  });

  describe("GET /_control", () => {
    it("reports the default configuration", async () => {
      const res = await request(app).get("/_control").expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.config).toEqual({
        latencyMs: 0,
        errorRate: 0,
        errorStatus: 504,
        submitResultCode: null,
        rateLimitLimit: null,
        rateLimitRemaining: null,
        rateLimitReset: null,
      });
    });
  });

  describe("POST /_control", () => {
    it("updates the configuration", async () => {
      const res = await request(app)
        .post("/_control")
        .send({
          latencyMs: 25,
          errorRate: 0.5,
          errorStatus: 429,
          submitResultCode: "tx_bad_seq",
          rateLimitLimit: 100,
          rateLimitRemaining: 99,
          rateLimitReset: 30,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.config).toMatchObject({
        latencyMs: 25,
        errorRate: 0.5,
        errorStatus: 429,
        submitResultCode: "tx_bad_seq",
        rateLimitLimit: 100,
        rateLimitRemaining: 99,
        rateLimitReset: 30,
      });
    });

    it("keeps the new configuration for later requests", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "op_underfunded" })
        .expect(200);

      const res = await request(app).get("/_control").expect(200);

      expect(res.body.config.submitResultCode).toBe("op_underfunded");
    });

    it("clamps the error rate into the 0..1 range", async () => {
      const res = await request(app)
        .post("/_control")
        .send({ errorRate: 4 })
        .expect(200);

      expect(res.body.config.errorRate).toBe(1);

      const clamped = await request(app)
        .post("/_control")
        .send({ errorRate: -2 })
        .expect(200);

      expect(clamped.body.config.errorRate).toBe(0);
    });

    it("clamps a negative latency to zero", async () => {
      const res = await request(app)
        .post("/_control")
        .send({ latencyMs: -100 })
        .expect(200);

      expect(res.body.config.latencyMs).toBe(0);
    });

    it("ignores values of the wrong type", async () => {
      const res = await request(app)
        .post("/_control")
        .send({ latencyMs: "fast", errorRate: "always" })
        .expect(200);

      expect(res.body.config.latencyMs).toBe(0);
      expect(res.body.config.errorRate).toBe(0);
    });

    it("can clear the transaction failure code", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "tx_bad_seq" })
        .expect(200);

      const res = await request(app)
        .post("/_control")
        .send({ submitResultCode: null })
        .expect(200);

      expect(res.body.config.submitResultCode).toBeNull();
    });
  });

  describe("POST /_control/reset", () => {
    it("restores the default configuration", async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, submitResultCode: "tx_bad_seq" })
        .expect(200);

      const res = await request(app).post("/_control/reset").expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.config.errorRate).toBe(0);
      expect(res.body.config.submitResultCode).toBeNull();
    });

    it("restores the overrides the app was created with", async () => {
      const overridden = createMockHorizonApp({ errorStatus: 429 });

      await request(overridden)
        .post("/_control")
        .send({ errorStatus: 504 })
        .expect(200);

      const res = await request(overridden).post("/_control/reset").expect(200);

      expect(res.body.config.errorStatus).toBe(429);
    });
  });

  describe("Programmatic helpers", () => {
    it("reads the current configuration", () => {
      expect(app.getConfig()).toMatchObject({
        latencyMs: 0,
        errorRate: 0,
        submitResultCode: null,
      });
    });

    it("updates the configuration", async () => {
      app.setConfig({ submitResultCode: "tx_bad_seq" });

      expect(app.getConfig().submitResultCode).toBe("tx_bad_seq");

      await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);
    });

    it("restores the configuration it was created with", () => {
      const overridden = createMockHorizonApp({ errorStatus: 429 });

      overridden.setConfig({ errorStatus: 504 });
      expect(overridden.getConfig().errorStatus).toBe(504);

      overridden.resetConfig();
      expect(overridden.getConfig().errorStatus).toBe(429);
    });
  });

  describe("Failure injection", () => {
    it("delays responses by the configured latency", async () => {
      await request(app)
        .post("/_control")
        .send({ latencyMs: 80 })
        .expect(200);

      const started = Date.now();
      await request(app).get(`/accounts/${ACCOUNT_ID}`).expect(200);

      expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    });

    it("does not delay the control and health endpoints", async () => {
      await request(app)
        .post("/_control")
        .send({ latencyMs: 400 })
        .expect(200);

      const started = Date.now();
      await request(app).get("/health").expect(200);
      await request(app).get("/_control").expect(200);

      expect(Date.now() - started).toBeLessThan(300);
    });

    it("adds the rate limit headers when they are configured", async () => {
      await request(app)
        .post("/_control")
        .send({ rateLimitLimit: 60, rateLimitRemaining: 59, rateLimitReset: 10 })
        .expect(200);

      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(res.headers["x-ratelimit-limit"]).toBe("60");
      expect(res.headers["x-ratelimit-remaining"]).toBe("59");
      expect(res.headers["x-ratelimit-reset"]).toBe("10");
    });

    it("omits the rate limit headers when they are not configured", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
      expect(res.headers["x-ratelimit-reset"]).toBeUndefined();
    });

    it("injects errors while an error rate is configured", async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, errorStatus: 504 })
        .expect(200);

      await request(app).get(`/accounts/${ACCOUNT_ID}`).expect(504);

      await request(app)
        .post("/_control")
        .send({ errorRate: 0 })
        .expect(200);

      await request(app).get(`/accounts/${ACCOUNT_ID}`).expect(200);
    });
  });
});
