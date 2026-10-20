/**
 * mock-horizon/server.js
 * Configurable Express server that mimics the Stellar Horizon API endpoints
 * used by the backend and frontend during integration tests.
 *
 * Supports configurable latency, random error injection (504/429),
 * rate-limit headers, and specific transaction submission failure result codes
 * (e.g., tx_bad_seq, op_underfunded) via environment variables or runtime control endpoints.
 *
 * Response shapes follow the public Horizon API (https://developers.stellar.org/docs/data/apis/horizon).
 * `__tests__/horizon-contract.test.js` pins the fields every endpoint returns,
 * so the mock cannot silently drift away from the contract the backend and the
 * frontend are written against.
 */

"use strict";

const express = require("express");

const DEFAULT_PORT = process.env.PORT || 8000;

// Horizon reports every failure as a problem document whose `type` is one of
// these slugs.
const HORIZON_ERROR_BASE = "https://stellar.org/horizon-errors/";

// The mock is a permissive test double: every account id is accepted, so the
// fixtures below have to work with ids that are not valid Stellar keys.
const MOCK_TRANSACTION_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const MOCK_RECEIVER =
  "GBMOCK000RECEIVER000000000000000000000000000000000000000";

/**
 * Sends a Horizon problem document — the envelope Horizon uses for every
 * non-2xx response.
 *
 * @param {import("express").Response} res Express response
 * @param {number} status HTTP status code
 * @param {string} slug Horizon error slug (e.g. "not_found")
 * @param {string} title Short human-readable title
 * @param {string} detail Longer explanation
 * @param {object} [extras] Optional `extras` payload
 */
function sendHorizonProblem(res, status, slug, title, detail, extras) {
  const problem = {
    type: `${HORIZON_ERROR_BASE}${slug}`,
    title,
    status,
    detail,
  };

  if (extras) {
    problem.extras = extras;
  }

  return res.status(status).json(problem);
}

/**
 * Builds the `href` of a collection page link the way Horizon does: the
 * request path plus the paging parameters that produced the page.
 *
 * @param {string} path Request path
 * @param {import("express").Request} req Express request
 * @param {string} cursor Paging cursor
 * @returns {string} Link href
 */
function buildPageHref(path, req, cursor = "") {
  const limit = Number.parseInt(req.query.limit, 10) || 10;
  const order = req.query.order === "desc" ? "desc" : "asc";
  const resolvedCursor = cursor ?? "";

  return `${path}?cursor=${encodeURIComponent(resolvedCursor)}&limit=${limit}&order=${order}`;
}

function getEnvConfig() {
  return {
    latencyMs: parseInt(process.env.LATENCY_MS || process.env.MOCK_HORIZON_LATENCY_MS || "0", 10) || 0,
    errorRate: parseFloat(process.env.ERROR_RATE || process.env.MOCK_HORIZON_ERROR_RATE || "0") || 0,
    errorStatus: parseInt(process.env.ERROR_STATUS || process.env.MOCK_HORIZON_ERROR_STATUS || "504", 10) || 504,
    submitResultCode: process.env.SUBMISSION_RESULT_CODE || process.env.MOCK_HORIZON_SUBMIT_RESULT_CODE || null,
    rateLimitLimit: process.env.RATE_LIMIT_LIMIT ? parseInt(process.env.RATE_LIMIT_LIMIT, 10) : null,
    rateLimitRemaining: process.env.RATE_LIMIT_REMAINING ? parseInt(process.env.RATE_LIMIT_REMAINING, 10) : null,
    rateLimitReset: process.env.RATE_LIMIT_RESET ? parseInt(process.env.RATE_LIMIT_RESET, 10) : null,
  };
}

function createMockHorizonApp(initialOverrides = {}) {
  const app = express();
  let config = { ...getEnvConfig(), ...initialOverrides };

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // CORS headers for frontend integration
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // ── Runtime Control Endpoints ───────────────────────────────────────────────
  app.get("/_control", (req, res) => {
    res.json({ success: true, config });
  });

  app.post("/_control", (req, res) => {
    const updates = req.body || {};
    if (typeof updates.latencyMs === "number") config.latencyMs = Math.max(0, updates.latencyMs);
    if (typeof updates.errorRate === "number") config.errorRate = Math.min(1, Math.max(0, updates.errorRate));
    if (typeof updates.errorStatus === "number") config.errorStatus = updates.errorStatus;
    if ("submitResultCode" in updates) config.submitResultCode = updates.submitResultCode;
    if ("rateLimitLimit" in updates) config.rateLimitLimit = updates.rateLimitLimit;
    if ("rateLimitRemaining" in updates) config.rateLimitRemaining = updates.rateLimitRemaining;
    if ("rateLimitReset" in updates) config.rateLimitReset = updates.rateLimitReset;

    res.json({ success: true, message: "Mock Horizon configuration updated", config });
  });

  app.post("/_control/reset", (req, res) => {
    config = { ...getEnvConfig(), ...initialOverrides };
    res.json({ success: true, message: "Mock Horizon configuration reset to defaults", config });
  });

  // ── Latency, Rate Limit, and Error Injection Middleware ─────────────────────
  app.use(async (req, res, next) => {
    // Control and health routes bypass latency and error injection
    if (req.path.startsWith("/_control") || req.path === "/health") {
      return next();
    }

    // Attach rate-limit headers if configured
    if (config.rateLimitLimit !== null) {
      res.setHeader("X-RateLimit-Limit", config.rateLimitLimit);
    }
    if (config.rateLimitRemaining !== null) {
      res.setHeader("X-RateLimit-Remaining", config.rateLimitRemaining);
    }
    if (config.rateLimitReset !== null) {
      res.setHeader("X-RateLimit-Reset", config.rateLimitReset);
    }

    // Artificial latency
    if (config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.latencyMs));
    }

    // Error-rate injection (e.g. 504 Gateway Timeout or 429 Too Many Requests)
    if (config.errorRate > 0 && Math.random() < config.errorRate) {
      if (config.errorStatus === 429) {
        return res.status(429).json({
          type: "https://stellar.org/horizon-errors/rate_limit_exceeded",
          title: "Rate Limit Exceeded",
          status: 429,
          detail: "The rate limit for the requested endpoint has been exceeded.",
        });
      }

      return res.status(config.errorStatus || 504).json({
        type: "https://stellar.org/horizon-errors/timeout",
        title: "Gateway Timeout",
        status: config.errorStatus || 504,
        detail: "The Horizon server timed out waiting for the response from stellar-core.",
      });
    }

    next();
  });

  // ── Horizon API Endpoints ───────────────────────────────────────────────────

  // Root / capability endpoint
  app.get("/", (req, res) => {
    res.json({
      _links: {
        account: { href: "{base_url}/accounts/{account_id}", templated: true },
        transactions: { href: "{base_url}/transactions{?cursor,limit,order}", templated: true },
      },
      horizon_version: "mock-2.1.0",
      core_version: "mock",
      network_passphrase: "Test SDF Network ; September 2015",
    });
  });

  // Account endpoint
  app.get("/accounts/:accountId", (req, res) => {
    const { accountId } = req.params;

    res.json({
      id: accountId,
      account_id: accountId,
      sequence: "1234567890",
      subentry_count: 0,
      last_modified_ledger: 12345,
      last_modified_time: new Date().toISOString(),
      thresholds: {
        low_threshold: 0,
        med_threshold: 0,
        high_threshold: 0,
      },
      flags: {
        auth_required: false,
        auth_revocable: false,
        auth_immutable: false,
        auth_clawback_enabled: false,
      },
      balances: [
        {
          balance: "100.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          asset_type: "native",
        },
      ],
      signers: [
        {
          key: accountId,
          weight: 1,
          type: "ed25519_public_key",
        },
      ],
      data: {},
      num_sponsoring: 0,
      num_sponsored: 0,
      paging_token: accountId,
      _links: {
        self: { href: `/accounts/${accountId}` },
        transactions: { href: `/accounts/${accountId}/transactions` },
        operations: { href: `/accounts/${accountId}/operations` },
        payments: { href: `/accounts/${accountId}/payments` },
        effects: { href: `/accounts/${accountId}/effects` },
        offers: { href: `/accounts/${accountId}/offers` },
        data: { href: `/accounts/${accountId}/data/{key}` },
      },
    });
  });

  // Payments endpoint
  app.get("/accounts/:accountId/payments", (req, res) => {
    const { accountId } = req.params;
    const collectionPath = `/accounts/${accountId}/payments`;
    const payment = {
      _links: {
        self: { href: `/operations/mock-payment-1` },
        transaction: { href: `/transactions/${MOCK_TRANSACTION_HASH}` },
        effects: { href: `/operations/mock-payment-1/effects` },
        succeeds: { href: `/transactions/${MOCK_TRANSACTION_HASH}?cursor=mock-payment-1` },
      },
      id: "mock-payment-1",
      paging_token: "mock-payment-1",
      transaction_successful: true,
      source_account: accountId,
      type: "payment",
      type_i: 1,
      created_at: new Date().toISOString(),
      transaction_hash: MOCK_TRANSACTION_HASH,
      asset_type: "native",
      from: accountId,
      to: MOCK_RECEIVER,
      amount: "10.0000000",
    };

    res.json({
      _links: {
        self: { href: buildPageHref(collectionPath, req) },
        next: { href: buildPageHref(collectionPath, req, payment.paging_token) },
        prev: { href: buildPageHref(collectionPath, req, "") },
      },
      _embedded: {
        records: [payment],
      },
    });
  });

  // Transactions endpoint
  app.get("/accounts/:accountId/transactions", (req, res) => {
    const { accountId } = req.params;
    const collectionPath = `/accounts/${accountId}/transactions`;

    res.json({
      _links: {
        self: { href: buildPageHref(collectionPath, req) },
        next: { href: buildPageHref(collectionPath, req) },
        prev: { href: buildPageHref(collectionPath, req) },
      },
      _embedded: { records: [] },
    });
  });

  // Fee stats endpoint
  app.get("/fee_stats", (req, res) => {
    // Horizon nests the accepted-fee percentiles under `fee_charged` and
    // `max_fee`; the frontend reads `fee_charged.mode`, `.p50`, `.p95` and
    // `.p99` from here.
    const percentiles = {
      max: "100",
      min: "100",
      mode: "100",
      p10: "100",
      p20: "100",
      p30: "100",
      p40: "100",
      p50: "100",
      p60: "100",
      p70: "100",
      p80: "100",
      p90: "100",
      p95: "100",
      p99: "100",
    };

    res.json({
      last_ledger: "123456",
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.04",
      fee_charged: { ...percentiles },
      max_fee: { ...percentiles },
    });
  });

  // Ledgers endpoint
  app.get("/ledgers", (req, res) => {
    res.json({
      _links: {
        self: { href: buildPageHref("/ledgers", req) },
        next: { href: buildPageHref("/ledgers", req, "12345") },
        prev: { href: buildPageHref("/ledgers", req, "") },
      },
      _embedded: {
        records: [
          {
            _links: {
              self: { href: "/ledgers/12345" },
              transactions: { href: "/ledgers/12345/transactions" },
              operations: { href: "/ledgers/12345/operations" },
              payments: { href: "/ledgers/12345/payments" },
              effects: { href: "/ledgers/12345/effects" },
            },
            id: "ledger-1",
            paging_token: "12345",
            hash: MOCK_TRANSACTION_HASH,
            prev_hash: MOCK_TRANSACTION_HASH,
            sequence: 12345,
            successful_transaction_count: 10,
            failed_transaction_count: 0,
            operation_count: 20,
            tx_set_operation_count: 20,
            closed_at: new Date().toISOString(),
            total_coins: "100000000.0000000",
            fee_pool: "0.0000000",
            base_fee_in_stroops: 100,
            base_reserve_in_stroops: 5000000,
            max_tx_set_size: 50,
            protocol_version: 22,
          },
        ],
      },
    });
  });

  // Submit transaction
  app.post("/transactions", (req, res) => {
    const rawTx = req.body?.tx || "";

    // Specific transaction failure injection
    if (config.submitResultCode) {
      let resultCodes = {};

      if (config.submitResultCode === "tx_bad_seq") {
        resultCodes = { transaction: "tx_bad_seq" };
      } else if (config.submitResultCode === "op_underfunded") {
        resultCodes = {
          transaction: "tx_failed",
          operations: ["op_underfunded"],
        };
      } else {
        resultCodes = {
          transaction: config.submitResultCode,
          operations: [config.submitResultCode],
        };
      }

      return sendHorizonProblem(
        res,
        400,
        "transaction_failed",
        "Transaction Failed",
        `The transaction failed when submitted to the stellar network: ${config.submitResultCode}`,
        {
          envelope_xdr: rawTx,
          result_xdr: "",
          result_codes: resultCodes,
        }
      );
    }

    res.status(200).json({
      hash: "mocktxhash0000000000000000000000000000000000000000000000000000",
      ledger: 12345,
      result_xdr: "",
      result_meta_xdr: "",
      envelope_xdr: rawTx,
    });
  });

  // Health check
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  // ── Fallbacks ──────────────────────────────────────────────────────────────
  // Unknown routes answer with the same problem document Horizon uses instead
  // of Express' default HTML page, so a test that hits an unimplemented
  // endpoint fails with a parseable error.
  app.use((req, res) =>
    sendHorizonProblem(
      res,
      404,
      "not_found",
      "Resource Missing",
      "The resource at the url requested was not found.  This usually occurs for one of two reasons:  The url requested is not valid, or no data in our database could be found with the parameters provided."
    )
  );

  // A malformed JSON body reaches Express' body parser as a syntax error;
  // Horizon reports those as a `bad_request` problem document too.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      return sendHorizonProblem(
        res,
        400,
        "bad_request",
        "Bad Request",
        "The request you sent was invalid in some way."
      );
    }

    return res.status(500).json({
      type: `${HORIZON_ERROR_BASE}server_error`,
      title: "Internal Server Error",
      status: 500,
      detail: "The request could not be completed because of an internal error.",
    });
  });

  // Helper method on app for programmatic testing
  app.setConfig = (newConfig) => {
    Object.assign(config, newConfig);
  };
  app.getConfig = () => ({ ...config });
  app.resetConfig = () => {
    config = { ...getEnvConfig(), ...initialOverrides };
  };

  return app;
}

const defaultApp = createMockHorizonApp();

if (require.main === module) {
  defaultApp.listen(DEFAULT_PORT, () => {
    console.log(`Mock Horizon server listening on http://0.0.0.0:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createMockHorizonApp,
  app: defaultApp,
};
