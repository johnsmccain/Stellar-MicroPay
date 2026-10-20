/**
 * mock-horizon/__tests__/helpers/horizon-contract.js
 * Shared expectations describing the response shapes of the public Horizon API.
 *
 * The field lists were captured from a live Horizon instance
 * (horizon-testnet.stellar.org) and trimmed to the fields the backend and the
 * frontend actually read. The helpers below turn each list into assertions, so
 * a renamed or dropped field in `server.js` fails the suite instead of letting
 * the mock drift away from the contract the app is written against.
 *
 * See https://developers.stellar.org/docs/data/apis/horizon/api-reference
 */

"use strict";

const HORIZON_ERROR_BASE = "https://stellar.org/horizon-errors/";

/** Fields every Horizon error response carries. */
const PROBLEM_FIELDS = {
  type: "string",
  title: "string",
  status: "number",
  detail: "string",
};

/** Root document (`GET /`). */
const ROOT_FIELDS = {
  _links: "object",
  horizon_version: "string",
  core_version: "string",
  network_passphrase: "string",
};

/** Account record (`GET /accounts/:account_id`). */
const ACCOUNT_FIELDS = {
  id: "string",
  account_id: "string",
  sequence: "string",
  subentry_count: "number",
  last_modified_ledger: "number",
  last_modified_time: "string",
  thresholds: "object",
  flags: "object",
  balances: "array",
  signers: "array",
  data: "object",
  num_sponsoring: "number",
  num_sponsored: "number",
  paging_token: "string",
  _links: "object",
};

/** Balance entry of an account record. */
const BALANCE_FIELDS = {
  balance: "string",
  buying_liabilities: "string",
  selling_liabilities: "string",
  asset_type: "string",
};

/** Signer entry of an account record. */
const SIGNER_FIELDS = {
  key: "string",
  weight: "number",
  type: "string",
};

/** Threshold entry of an account record. */
const THRESHOLD_FIELDS = {
  low_threshold: "number",
  med_threshold: "number",
  high_threshold: "number",
};

/** Payment operation record (`GET /accounts/:account_id/payments`). */
const PAYMENT_FIELDS = {
  id: "string",
  paging_token: "string",
  transaction_successful: "boolean",
  source_account: "string",
  type: "string",
  type_i: "number",
  created_at: "string",
  transaction_hash: "string",
  asset_type: "string",
  from: "string",
  to: "string",
  amount: "string",
  _links: "object",
};

/** Ledger record (`GET /ledgers`). */
const LEDGER_FIELDS = {
  id: "string",
  paging_token: "string",
  hash: "string",
  prev_hash: "string",
  sequence: "number",
  successful_transaction_count: "number",
  failed_transaction_count: "number",
  operation_count: "number",
  tx_set_operation_count: "number",
  closed_at: "string",
  total_coins: "string",
  fee_pool: "string",
  base_fee_in_stroops: "number",
  base_reserve_in_stroops: "number",
  max_tx_set_size: "number",
  protocol_version: "number",
  _links: "object",
};

/** Fee statistics (`GET /fee_stats`). */
const FEE_STATS_FIELDS = {
  last_ledger: "string",
  last_ledger_base_fee: "string",
  ledger_capacity_usage: "string",
  fee_charged: "object",
  max_fee: "object",
};

/** Percentile breakdown nested under `fee_charged` / `max_fee`. */
const FEE_PERCENTILE_FIELDS = {
  max: "string",
  min: "string",
  mode: "string",
  p10: "string",
  p20: "string",
  p30: "string",
  p40: "string",
  p50: "string",
  p60: "string",
  p70: "string",
  p80: "string",
  p90: "string",
  p95: "string",
  p99: "string",
};

/** Submitted transaction (`POST /transactions`). */
const TRANSACTION_SUBMISSION_FIELDS = {
  hash: "string",
  ledger: "number",
  result_xdr: "string",
  result_meta_xdr: "string",
  envelope_xdr: "string",
};

const TYPE_CHECKS = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  object: (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
};

/**
 * Describes the runtime type of a value for assertion messages.
 *
 * @param {unknown} value Value to describe
 * @returns {string} Human-readable type name
 */
function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Asserts that a response body carries every field of a Horizon shape, with
 * the expected JSON type.
 *
 * @param {object} body Response body
 * @param {Record<string, string>} fields Field name → JSON type
 */
function expectHorizonShape(body, fields) {
  expect(body).toBeTruthy();

  const missing = Object.keys(fields).filter(
    (field) => !Object.prototype.hasOwnProperty.call(body, field)
  );
  expect(missing).toEqual([]);

  const wrongTypes = Object.entries(fields)
    .filter(([field, type]) => !TYPE_CHECKS[type](body[field]))
    .map(
      ([field, type]) =>
        `${field} (expected ${type}, got ${describeType(body[field])})`
    );
  expect(wrongTypes).toEqual([]);
}

/**
 * Asserts that a body is a Horizon problem document.
 *
 * @param {object} body Response body
 * @param {{status?: number, slug?: string, title?: string}} [expected] Expected values
 */
function expectHorizonProblem(body, expected = {}) {
  expectHorizonShape(body, PROBLEM_FIELDS);

  expect(body.type.startsWith(HORIZON_ERROR_BASE)).toBe(true);
  expect(body.status).toBe(expected.status ?? body.status);
  expect(body.detail.length).toBeGreaterThan(0);

  if (expected.slug) {
    expect(body.type).toBe(`${HORIZON_ERROR_BASE}${expected.slug}`);
  }
  if (expected.title) {
    expect(body.title).toBe(expected.title);
  }
}

/**
 * Asserts that a `_links` object carries the given relations and that every
 * relation points at a non-empty href.
 *
 * @param {object} links `_links` object
 * @param {string[]} [relations] Relations that must be present
 */
function expectHorizonLinks(links, relations = []) {
  expect(typeof links).toBe("object");
  expect(links).not.toBeNull();
  expect(Array.isArray(links)).toBe(false);

  for (const relation of relations) {
    expect(Object.prototype.hasOwnProperty.call(links, relation)).toBe(true);
    expect(typeof links[relation].href).toBe("string");
    expect(links[relation].href.length).toBeGreaterThan(0);
  }
}

/**
 * Asserts that a body is a Horizon collection page.
 *
 * @param {object} body Response body
 * @param {{selfPath?: string, relations?: string[]}} [expected] Expected values
 */
function expectHorizonPage(body, expected = {}) {
  expectHorizonLinks(body._links, expected.relations ?? ["self", "next", "prev"]);

  if (expected.selfPath) {
    expect(body._links.self.href).toContain(expected.selfPath);
  }

  expect(typeof body._embedded).toBe("object");
  expect(body._embedded).not.toBeNull();
  expect(Array.isArray(body._embedded.records)).toBe(true);
}

/**
 * Asserts that a value is an RFC 3339 timestamp in UTC, the format Horizon
 * uses for `created_at` and friends.
 *
 * @param {unknown} value Value to check
 */
function expectIsoTimestamp(value) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

module.exports = {
  ACCOUNT_FIELDS,
  BALANCE_FIELDS,
  FEE_PERCENTILE_FIELDS,
  FEE_STATS_FIELDS,
  HORIZON_ERROR_BASE,
  LEDGER_FIELDS,
  PAYMENT_FIELDS,
  PROBLEM_FIELDS,
  ROOT_FIELDS,
  SIGNER_FIELDS,
  THRESHOLD_FIELDS,
  TRANSACTION_SUBMISSION_FIELDS,
  expectHorizonLinks,
  expectHorizonPage,
  expectHorizonProblem,
  expectHorizonShape,
  expectIsoTimestamp,
};
