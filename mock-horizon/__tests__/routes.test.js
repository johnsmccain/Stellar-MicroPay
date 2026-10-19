/**
 * mock-horizon/__tests__/routes.test.js
 * Behaviour of every endpoint the mock implements.
 *
 * The suite covers the success path of each route with the fixtures the mock
 * documents, so a change to a fixture or to a status code is caught here. The
 * response *shapes* are pinned separately in `horizon-contract.test.js`.
 *
 * Issue #1420
 */

"use strict";

const request = require("supertest");
const { createMockHorizonApp } = require("../server");

const ACCOUNT_ID =
  "GB7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const MOCK_RECEIVER =
  "GBMOCK000RECEIVER000000000000000000000000000000000000000";

describe("mock-horizon routes (#1420)", () => {
  let app;

  beforeEach(() => {
    app = createMockHorizonApp();
  });

  describe("GET /", () => {
    it("returns the mock's version information", async () => {
      const res = await request(app).get("/").expect(200);

      expect(res.body.horizon_version).toBe("mock-2.1.0");
      expect(res.body.core_version).toBe("mock");
    });

    it("answers with JSON", async () => {
      const res = await request(app).get("/").expect(200);

      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("GET /health", () => {
    it("reports that the mock is up", async () => {
      const res = await request(app).get("/health").expect(200);

      expect(res.body).toEqual({ status: "ok" });
    });

    it("bypasses error injection so the healthcheck stays green", async () => {
      await request(app)
        .post("/_control")
        .send({ errorRate: 1.0, errorStatus: 504 })
        .expect(200);

      const res = await request(app).get("/health").expect(200);

      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("GET /accounts/:accountId", () => {
    it("returns the account fixture for the requested id", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(res.body.account_id).toBe(ACCOUNT_ID);
      expect(res.body.sequence).toBe("1234567890");
    });

    it("accepts any account id — the mock keeps no account list", async () => {
      const res = await request(app)
        .get("/accounts/G_TEST_ACCOUNT_123")
        .expect(200);

      expect(res.body.account_id).toBe("G_TEST_ACCOUNT_123");
    });

    it("returns a native balance fixture", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(res.body.balances).toEqual([
        {
          balance: "100.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          asset_type: "native",
        },
      ]);
    });
  });

  describe("GET /accounts/:accountId/payments", () => {
    it("returns a single native payment from the requested account", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/payments`)
        .expect(200);

      expect(res.body._embedded.records).toHaveLength(1);

      const [payment] = res.body._embedded.records;
      expect(payment.type).toBe("payment");
      expect(payment.from).toBe(ACCOUNT_ID);
      expect(payment.to).toBe(MOCK_RECEIVER);
      expect(payment.amount).toBe("10.0000000");
      expect(payment.asset_type).toBe("native");
      expect(payment.id).toBe("mock-payment-1");
    });

    it("reflects the paging parameters in the collection links", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/payments?limit=25&order=desc`)
        .expect(200);

      expect(res.body._links.self.href).toContain("limit=25");
      expect(res.body._links.self.href).toContain("order=desc");
      expect(res.body._links.next.href).toContain("limit=25");
    });
  });

  describe("GET /accounts/:accountId/transactions", () => {
    it("returns an empty page", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/transactions`)
        .expect(200);

      expect(res.body._embedded.records).toEqual([]);
    });
  });

  describe("GET /fee_stats", () => {
    it("returns the base fee fixture", async () => {
      const res = await request(app).get("/fee_stats").expect(200);

      expect(res.body.last_ledger_base_fee).toBe("100");
      expect(res.body.fee_charged.mode).toBe("100");
    });
  });

  describe("GET /ledgers", () => {
    it("returns the recent ledger fixture", async () => {
      const res = await request(app).get("/ledgers").expect(200);

      expect(res.body._embedded.records).toHaveLength(1);
      expect(res.body._embedded.records[0].sequence).toBe(12345);
    });
  });

  describe("POST /transactions", () => {
    it("accepts a transaction and returns its hash", async () => {
      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(200);

      expect(res.body.hash).toEqual(expect.any(String));
      expect(res.body.ledger).toBe(12345);
      expect(res.body.envelope_xdr).toBe("AAAA_MOCK_TX_ENVELOPE_XDR");
    });

    it("accepts form-encoded bodies, the way the Stellar SDK submits", async () => {
      const res = await request(app)
        .post("/transactions")
        .type("form")
        .send({ tx: "AAAA_FORM_ENCODED_TX_ENVELOPE_XDR" })
        .expect(200);

      expect(res.body.envelope_xdr).toBe("AAAA_FORM_ENCODED_TX_ENVELOPE_XDR");
    });

    it("answers with an empty envelope when no transaction is sent", async () => {
      const res = await request(app).post("/transactions").expect(200);

      expect(res.body.envelope_xdr).toBe("");
    });
  });

  describe("CORS", () => {
    it("allows cross-origin requests", async () => {
      const res = await request(app).get("/health").expect(200);

      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("answers preflight requests with 204", async () => {
      const res = await request(app)
        .options("/accounts/" + ACCOUNT_ID)
        .expect(204);

      expect(res.headers["access-control-allow-methods"]).toContain("POST");
      expect(res.headers["access-control-allow-headers"]).toContain(
        "Content-Type"
      );
    });
  });
});
