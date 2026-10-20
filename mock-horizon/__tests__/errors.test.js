/**
 * mock-horizon/__tests__/errors.test.js
 * Error responses of every endpoint the mock implements.
 *
 * Horizon answers failures with a problem document; the mock has to do the
 * same, otherwise a test that asserts on an error body either crashes on the
 * HTML fallback or silently matches the wrong shape. The injected failures
 * (504, 429) and the transaction failure codes are covered here as well,
 * because they are the scenarios the backend's failure handling is written
 * against.
 *
 * Issue #1420
 */

"use strict";

const request = require("supertest");
const { createMockHorizonApp } = require("../server");
const {
  expectHorizonProblem,
} = require("./helpers/horizon-contract");

const ACCOUNT_ID =
  "GB7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("mock-horizon error responses (#1420)", () => {
  let app;

  beforeEach(() => {
    app = createMockHorizonApp();
  });

  describe("Unknown resources", () => {
    it("answers an unknown route with a 404 problem document", async () => {
      const res = await request(app).get("/does-not-exist").expect(404);

      expectHorizonProblem(res.body, {
        status: 404,
        slug: "not_found",
        title: "Resource Missing",
      });
    });

    it("answers an unknown collection with a 404 problem document", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/unknown`)
        .expect(404);

      expectHorizonProblem(res.body, { status: 404, slug: "not_found" });
    });

    it("does not answer with Express' HTML fallback", async () => {
      const res = await request(app).get("/does-not-exist").expect(404);

      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.text).not.toContain("<!DOCTYPE html>");
    });
  });

  describe("Malformed requests", () => {
    it("answers a malformed JSON body with a 400 problem document", async () => {
      const res = await request(app)
        .post("/transactions")
        .set("Content-Type", "application/json")
        .send("{not-json")
        .expect(400);

      expectHorizonProblem(res.body, {
        status: 400,
        slug: "bad_request",
        title: "Bad Request",
      });
    });

    it("answers an unexpected failure with a problem document", async () => {
      // A body above the 100 kB limit of the JSON parser reaches the error
      // handler; it must not fall back to Express' HTML error page.
      const res = await request(app)
        .post("/transactions")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ tx: "x".repeat(200 * 1024) }))
        .expect(500);

      expectHorizonProblem(res.body, { status: 500, slug: "server_error" });
    });
  });

  describe("Injected gateway timeout", () => {
    const routes = [
      { name: "GET /", send: (target) => request(target).get("/") },
      {
        name: "GET /accounts/:accountId",
        send: (target) => request(target).get(`/accounts/${ACCOUNT_ID}`),
      },
      {
        name: "GET /accounts/:accountId/payments",
        send: (target) => request(target).get(`/accounts/${ACCOUNT_ID}/payments`),
      },
      {
        name: "GET /accounts/:accountId/transactions",
        send: (target) =>
          request(target).get(`/accounts/${ACCOUNT_ID}/transactions`),
      },
      {
        name: "GET /fee_stats",
        send: (target) => request(target).get("/fee_stats"),
      },
      { name: "GET /ledgers", send: (target) => request(target).get("/ledgers") },
      {
        name: "POST /transactions",
        send: (target) =>
          request(target).post("/transactions").send({ tx: "AAAA_XDR" }),
      },
    ];

    beforeEach(async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, errorStatus: 504 })
        .expect(200);
    });

    it.each(routes)("answers $name with a 504 problem document", async ({ send }) => {
      const res = await send(app).expect(504);

      expectHorizonProblem(res.body, {
        status: 504,
        slug: "timeout",
        title: "Gateway Timeout",
      });
    });

    it("leaves the control endpoint usable", async () => {
      const res = await request(app).get("/_control").expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("Injected rate limit", () => {
    beforeEach(async () => {
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
    });

    it("answers with a 429 problem document", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(429);

      expectHorizonProblem(res.body, {
        status: 429,
        slug: "rate_limit_exceeded",
        title: "Rate Limit Exceeded",
      });
    });

    it("reports the configured rate limit headers", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(429);

      expect(res.headers["x-ratelimit-limit"]).toBe("100");
      expect(res.headers["x-ratelimit-remaining"]).toBe("0");
      expect(res.headers["x-ratelimit-reset"]).toBe("30");
    });
  });

  describe("Transaction submission failures", () => {
    it("reports a sequence mismatch as a transaction failure", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "tx_bad_seq" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expectHorizonProblem(res.body, {
        status: 400,
        slug: "transaction_failed",
        title: "Transaction Failed",
      });
      expect(res.body.extras.result_codes).toEqual({
        transaction: "tx_bad_seq",
      });
    });

    it("reports an underfunded operation as a transaction failure", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "op_underfunded" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expect(res.body.extras.result_codes).toEqual({
        transaction: "tx_failed",
        operations: ["op_underfunded"],
      });
    });

    it("reports an arbitrary result code on both levels", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "op_no_destination" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expect(res.body.extras.result_codes).toEqual({
        transaction: "op_no_destination",
        operations: ["op_no_destination"],
      });
    });

    it("echoes the submitted envelope in extras", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "tx_bad_seq" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      expect(res.body.extras.envelope_xdr).toBe("AAAA_MOCK_TX_ENVELOPE_XDR");
    });

    it("returns the result codes in the shape the Stellar SDK reads", async () => {
      await request(app)
        .post("/_control")
        .send({ submitResultCode: "op_underfunded" })
        .expect(200);

      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(400);

      // `TransactionFailedError.getResultCodes()` in the Stellar SDK reads
      // `extras.result_codes.transaction` and `extras.result_codes.operations`.
      const { transaction, operations = [] } = res.body.extras.result_codes;
      expect(typeof transaction).toBe("string");
      expect(Array.isArray(operations)).toBe(true);
    });
  });
});
