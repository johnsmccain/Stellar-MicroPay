/**
 * mock-horizon/__tests__/horizon-contract.test.js
 * Pins the mock's responses to the shapes the public Horizon API returns.
 *
 * The mock exists so integration tests can run without the live testnet. That
 * only works while the mock keeps answering like Horizon does: when a field
 * is renamed or dropped, the integration tests keep passing while validating
 * the wrong contract. This suite is the guard — it asserts the field names,
 * JSON types and link envelopes of every implemented endpoint against the
 * shapes documented at https://developers.stellar.org/docs/data/apis/horizon
 *
 * Issue #1420
 */

"use strict";

const request = require("supertest");
const { createMockHorizonApp } = require("../server");
const {
  ACCOUNT_FIELDS,
  BALANCE_FIELDS,
  FEE_PERCENTILE_FIELDS,
  FEE_STATS_FIELDS,
  LEDGER_FIELDS,
  PAYMENT_FIELDS,
  ROOT_FIELDS,
  SIGNER_FIELDS,
  THRESHOLD_FIELDS,
  TRANSACTION_SUBMISSION_FIELDS,
  expectHorizonLinks,
  expectHorizonPage,
  expectHorizonProblem,
  expectHorizonShape,
  expectIsoTimestamp,
} = require("./helpers/horizon-contract");

const ACCOUNT_ID =
  "GB7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("mock-horizon ↔ Horizon response contract (#1420)", () => {
  let app;

  beforeEach(() => {
    app = createMockHorizonApp();
  });

  describe("Root document", () => {
    it("returns Horizon's root document", async () => {
      const res = await request(app).get("/").expect(200);

      expectHorizonShape(res.body, ROOT_FIELDS);
      expect(res.body.horizon_version).toEqual(expect.any(String));
      expect(res.body.core_version).toEqual(expect.any(String));
    });

    it("advertises the testnet passphrase", async () => {
      const res = await request(app).get("/").expect(200);

      expect(res.body.network_passphrase).toBe(
        "Test SDF Network ; September 2015"
      );
    });

    it("exposes templated links", async () => {
      const res = await request(app).get("/").expect(200);

      expectHorizonLinks(res.body._links, ["account", "transactions"]);
      expect(res.body._links.account.templated).toBe(true);
      expect(res.body._links.account.href).toContain("{account_id}");
    });
  });

  describe("Account record", () => {
    it("returns the account fields Horizon returns", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expectHorizonShape(res.body, ACCOUNT_FIELDS);
      expect(res.body.id).toBe(ACCOUNT_ID);
      expect(res.body.account_id).toBe(ACCOUNT_ID);
    });

    it("returns the sequence as a string, like Horizon does", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(typeof res.body.sequence).toBe("string");
      expect(res.body.sequence).toMatch(/^\d+$/);
    });

    it("returns balance entries in Horizon's shape", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expect(res.body.balances.length).toBeGreaterThan(0);
      for (const balance of res.body.balances) {
        expectHorizonShape(balance, BALANCE_FIELDS);
      }
    });

    it("returns thresholds, signers and flags", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expectHorizonShape(res.body.thresholds, THRESHOLD_FIELDS);
      expect(res.body.signers.length).toBeGreaterThan(0);
      expectHorizonShape(res.body.signers[0], SIGNER_FIELDS);
      expect(typeof res.body.flags.auth_required).toBe("boolean");
    });

    it("links to the account's related collections", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}`)
        .expect(200);

      expectHorizonLinks(res.body._links, [
        "self",
        "transactions",
        "operations",
        "payments",
        "effects",
        "offers",
        "data",
      ]);
      expect(res.body._links.self.href).toBe(`/accounts/${ACCOUNT_ID}`);
    });
  });

  describe("Payments page", () => {
    it("returns a collection page in Horizon's shape", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/payments`)
        .expect(200);

      expectHorizonPage(res.body, { selfPath: `/accounts/${ACCOUNT_ID}/payments` });
    });

    it("returns payment records in Horizon's shape", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/payments`)
        .expect(200);

      expect(res.body._embedded.records.length).toBeGreaterThan(0);
      for (const record of res.body._embedded.records) {
        expectHorizonShape(record, PAYMENT_FIELDS);
        expectIsoTimestamp(record.created_at);
        expect(record.transaction_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("links each payment to its transaction and effects", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/payments`)
        .expect(200);

      const [payment] = res.body._embedded.records;
      expectHorizonLinks(payment._links, [
        "self",
        "transaction",
        "effects",
        "succeeds",
      ]);
    });
  });

  describe("Transactions page", () => {
    it("returns a collection page in Horizon's shape", async () => {
      const res = await request(app)
        .get(`/accounts/${ACCOUNT_ID}/transactions`)
        .expect(200);

      expectHorizonPage(res.body, {
        selfPath: `/accounts/${ACCOUNT_ID}/transactions`,
      });
      expect(res.body._embedded.records).toEqual([]);
    });
  });

  describe("Fee statistics", () => {
    it("nests the accepted fees under fee_charged and max_fee", async () => {
      const res = await request(app).get("/fee_stats").expect(200);

      expectHorizonShape(res.body, FEE_STATS_FIELDS);
      expectHorizonShape(res.body.fee_charged, FEE_PERCENTILE_FIELDS);
      expectHorizonShape(res.body.max_fee, FEE_PERCENTILE_FIELDS);
    });
  });

  describe("Ledgers page", () => {
    it("returns a collection page in Horizon's shape", async () => {
      const res = await request(app).get("/ledgers").expect(200);

      expectHorizonPage(res.body, { selfPath: "/ledgers" });
    });

    it("returns ledger records in Horizon's shape", async () => {
      const res = await request(app).get("/ledgers").expect(200);

      expect(res.body._embedded.records.length).toBeGreaterThan(0);
      for (const record of res.body._embedded.records) {
        expectHorizonShape(record, LEDGER_FIELDS);
        expectIsoTimestamp(record.closed_at);
      }
    });
  });

  describe("Transaction submission", () => {
    it("returns the fields Horizon returns for an accepted transaction", async () => {
      const res = await request(app)
        .post("/transactions")
        .send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" })
        .expect(200);

      expectHorizonShape(res.body, TRANSACTION_SUBMISSION_FIELDS);
      expect(res.body.envelope_xdr).toBe("AAAA_MOCK_TX_ENVELOPE_XDR");
    });
  });

  describe("Error envelopes", () => {
    const errorCases = [
      {
        name: "an unknown route",
        request: (target) => request(target).get("/does-not-exist"),
        status: 404,
        slug: "not_found",
      },
      {
        name: "a malformed request body",
        request: (target) =>
          request(target)
            .post("/transactions")
            .set("Content-Type", "application/json")
            .send("{not json"),
        status: 400,
        slug: "bad_request",
      },
      {
        name: "a failed transaction submission",
        request: (target) =>
          request(target).post("/transactions").send({ tx: "AAAA_MOCK_TX_ENVELOPE_XDR" }),
        status: 400,
        slug: "transaction_failed",
        configure: async (target) => {
          await request(target)
            .post("/_control")
            .send({ submitResultCode: "tx_bad_seq" });
        },
      },
      {
        name: "an injected gateway timeout",
        request: (target) => request(target).get(`/accounts/${ACCOUNT_ID}`),
        status: 504,
        slug: "timeout",
        configure: async (target) => {
          await request(target)
            .post("/_control")
            .send({ errorRate: 1.0, errorStatus: 504 });
        },
      },
      {
        name: "an injected rate limit",
        request: (target) => request(target).get(`/accounts/${ACCOUNT_ID}`),
        status: 429,
        slug: "rate_limit_exceeded",
        configure: async (target) => {
          await request(target)
            .post("/_control")
            .send({ errorRate: 1.0, errorStatus: 429 });
        },
      },
    ];

    it.each(errorCases)(
      "answers $name with a Horizon problem document",
      async ({ request: send, status, slug, configure }) => {
        if (configure) {
          await configure(app);
        }

        const res = await send(app).expect(status);

        expectHorizonProblem(res.body, { status, slug });
      }
    );
  });
});
