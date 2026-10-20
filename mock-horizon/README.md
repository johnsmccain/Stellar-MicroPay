# 🧪 mock-horizon

A configurable [Express](https://expressjs.com/) server that imitates the [Stellar Horizon API](https://developers.stellar.org/docs/data/apis/horizon) endpoints used by the backend and frontend. It lets integration tests run without the live testnet, so they're fast, deterministic, work offline, and can simulate failure scenarios like network latency, gateway timeouts (504), rate limits (429), and transaction failure result codes (`tx_bad_seq`, `op_underfunded`).

It runs as the `mock-horizon` service in [`docker-compose.test.yml`](../docker-compose.test.yml).

---

## 🚀 Running it

### With the integration test stack (what CI does)

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test
docker compose -f docker-compose.test.yml down --volumes --remove-orphans
```

`backend-test` waits for the mock's `/health` healthcheck, then runs `npm test` with `HORIZON_URL=http://mock-horizon:8000`.

### On its own

```bash
# Docker
docker compose -f docker-compose.test.yml up --build mock-horizon   # → http://localhost:8000

# Or plain Node (20.19.5, see ../.nvmrc)
cd mock-horizon && npm install && npm start                          # → http://localhost:8000
PORT=8123 npm start                                                  # any other port
```

Quick check:

```bash
curl http://localhost:8000/health                       # {"status":"ok"}
curl http://localhost:8000/accounts/GABC                 # any ID works
```

---

## ⚡ Failure Injection & Configuration

Mock Horizon can be configured at startup via **environment variables** or at runtime via the **`/_control`** HTTP endpoint for per-test toggling.

### Configuration Parameters

| Parameter | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `latencyMs` | `LATENCY_MS` | `0` | Artificial delay added to responses in milliseconds. Useful for testing timeouts and circuit breaker behavior. |
| `errorRate` | `ERROR_RATE` | `0` | Probability between `0.0` and `1.0` of injecting an error response. |
| `errorStatus` | `ERROR_STATUS` | `504` | HTTP status code to return when error injection triggers (`504` Gateway Timeout or `429` Rate Limit Exceeded). |
| `submitResultCode` | `SUBMISSION_RESULT_CODE` | `null` | When set, `POST /transactions` fails with HTTP 400 and returns a Horizon problem document with this result code (e.g. `tx_bad_seq`, `op_underfunded`). |
| `rateLimitLimit` | `RATE_LIMIT_LIMIT` | `null` | Value for `X-RateLimit-Limit` response header. |
| `rateLimitRemaining` | `RATE_LIMIT_REMAINING` | `null` | Value for `X-RateLimit-Remaining` response header. |
| `rateLimitReset` | `RATE_LIMIT_RESET` | `null` | Value for `X-RateLimit-Reset` response header (seconds). |

---

### Runtime Control Endpoint (`/_control`)

You can dynamically adjust failure injection on the fly without restarting the server:

#### 1. Inspect Current Configuration
```bash
curl http://localhost:8000/_control
```
Response:
```json
{
  "success": true,
  "config": {
    "latencyMs": 0,
    "errorRate": 0,
    "errorStatus": 504,
    "submitResultCode": null,
    "rateLimitLimit": null,
    "rateLimitRemaining": null,
    "rateLimitReset": null
  }
}
```

#### 2. Inject Artificial Latency
Add a 200ms delay to every Horizon call:
```bash
curl -X POST http://localhost:8000/_control \
  -H "Content-Type: application/json" \
  -d '{"latencyMs": 200}'
```

#### 3. Inject Gateway Timeout (504) or Rate Limiting (429)
Make 50% of Horizon requests fail with a 504 Gateway Timeout:
```bash
curl -X POST http://localhost:8000/_control \
  -H "Content-Type: application/json" \
  -d '{"errorRate": 0.5, "errorStatus": 504}'
```

Simulate Horizon 429 Too Many Requests:
```bash
curl -X POST http://localhost:8000/_control \
  -H "Content-Type: application/json" \
  -d '{"errorRate": 1.0, "errorStatus": 429}'
```

#### 4. Inject Transaction Submission Failures
Simulate `tx_bad_seq` sequence mismatch error:
```bash
curl -X POST http://localhost:8000/_control \
  -H "Content-Type: application/json" \
  -d '{"submitResultCode": "tx_bad_seq"}'
```
`POST /transactions` returns HTTP 400 with:
```json
{
  "type": "https://stellar.org/horizon-errors/transaction_failed",
  "title": "Transaction Failed",
  "status": 400,
  "extras": {
    "result_codes": {
      "transaction": "tx_bad_seq"
    }
  }
}
```

Simulate `op_underfunded` (insufficient balance):
```bash
curl -X POST http://localhost:8000/_control \
  -H "Content-Type: application/json" \
  -d '{"submitResultCode": "op_underfunded"}'
```
`POST /transactions` returns HTTP 400 with:
```json
{
  "type": "https://stellar.org/horizon-errors/transaction_failed",
  "title": "Transaction Failed",
  "status": 400,
  "extras": {
    "result_codes": {
      "transaction": "tx_failed",
      "operations": ["op_underfunded"]
    }
  }
}
```

#### 5. Reset to Default Configuration
```bash
curl -X POST http://localhost:8000/_control/reset
```

---

## 📡 Implemented endpoints

Every response follows the shape of the public Horizon API (see the [Horizon API reference](https://developers.stellar.org/docs/data/apis/horizon/api-reference)). The field lists are pinned by the [mock's own test suite](#-testing), so the mock cannot drift away from the contract the backend and the frontend are written against.

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/` | Root document: `horizon_version: "mock-2.1.0"`, `core_version: "mock"`, testnet `network_passphrase` |
| `GET` | `/health` | `{"status":"ok"}`. Healthcheck endpoint (bypasses latency and error injection). |
| `GET` | `/_control` | Get current mock configuration. |
| `POST` | `/_control` | Dynamically update mock configuration. |
| `POST` | `/_control/reset` | Reset mock configuration to defaults. |
| `GET` | `/accounts/:accountId` | Account record (see fixtures). |
| `GET` | `/accounts/:accountId/payments` | One-record page with a single native payment. |
| `GET` | `/accounts/:accountId/transactions` | Empty page (`records: []`). |
| `GET` | `/fee_stats` | Fee stats with the accepted fees nested under `fee_charged` and `max_fee`. |
| `GET` | `/ledgers` | Recent ledger record. |
| `POST` | `/transactions` | Submits transaction. Responds 200 with hash or 400 if `submitResultCode` configured. |
| any | *unknown path* | 404 problem document (`not_found` / "Resource Missing"), like Horizon. |

### Error responses

Every non-2xx response is a Horizon problem document:

```json
{
  "type": "https://stellar.org/horizon-errors/not_found",
  "title": "Resource Missing",
  "status": 404,
  "detail": "The resource at the url requested was not found.  This usually occurs for one of two reasons:  The url requested is not valid, or no data in our database could be found with the parameters provided."
}
```

A failed transaction submission adds the result codes Horizon reports in `extras`:

```json
{
  "type": "https://stellar.org/horizon-errors/transaction_failed",
  "title": "Transaction Failed",
  "status": 400,
  "detail": "The transaction failed when submitted to the stellar network: tx_bad_seq",
  "extras": {
    "envelope_xdr": "AAAA…",
    "result_xdr": "",
    "result_codes": { "transaction": "tx_bad_seq" }
  }
}
```

`result_codes` has the shape the Stellar SDK reads in `TransactionFailedError.getResultCodes()`: a `transaction` code and an optional list of `operations` codes.

### Deliberate differences from Horizon

The mock is a permissive test double, so a few things differ from the real API on purpose:

| Difference | Why |
| --- | --- |
| Every account id is accepted, even one that is not a valid Stellar key | Tests use placeholder ids such as `G_TEST_ACCOUNT_123`; a real account list would make the fixtures unpredictable. |
| `POST /transactions` accepts a JSON body | The Stellar SDK submits `application/x-www-form-urlencoded`; the mock accepts both so a test can post either way. |
| The transactions page is always empty | There is no transaction history to serve. |
| Every collection is a single page | The paging parameters are echoed in the `_links`, but there is no second page to follow. |
| There is no streaming and no state | Every response is served from static fixtures. |

---

## 🗂 Fixtures

The mock has no state and no account list. **Every account ID is accepted** and gets standard testnet fixtures:

| Field | Value |
| --- | --- |
| `sequence` | `"1234567890"` |
| `balances` | `[{ "asset_type": "native", "balance": "100.0000000", "buying_liabilities": "0.0000000", "selling_liabilities": "0.0000000" }]` |
| `thresholds` | `{ "low_threshold": 0, "med_threshold": 0, "high_threshold": 0 }` |
| `signers` | `[{ "key": "<account id>", "weight": 1, "type": "ed25519_public_key" }]` |
| Payment `id` | `"mock-payment-1"` |
| Payment | `10.0000000` XLM `from` the requested account `to` `GBMOCK000RECEIVER000000000000000000000000000000000000000` |
| Payment `created_at` | Current time |
| Payment `transaction_hash` | 64 zeroes — a well-formed transaction hash |
| `fee_stats` | `last_ledger_base_fee: "100"`, percentiles nested under `fee_charged` and `max_fee` |
| Ledger `sequence` | `12345` |
| Submitted tx `hash` | `mocktxhash0000000000000000000000000000000000000000000000000000` |
| Submitted tx `ledger` | `12345` |
| Network passphrase | `Test SDF Network ; September 2015` (testnet) |

---

## 🧪 Testing

The mock has a test suite of its own. It asserts the response contract of every endpoint — field names, JSON types, `_links` and `_embedded.records` envelopes and the problem documents errors are reported in — against the shapes the public Horizon API returns, so a field that is renamed or dropped fails CI instead of silently invalidating the integration tests.

```bash
cd mock-horizon
npm ci
npm test                # the whole suite
npm run test:watch      # re-runs on change
npm run test:coverage   # coverage of server.js
```

| File | Covers |
| --- | --- |
| `__tests__/horizon-contract.test.js` | The response contract: field names, JSON types, link envelopes, problem documents |
| `__tests__/routes.test.js` | The success path of every implemented endpoint and its fixtures |
| `__tests__/errors.test.js` | Unknown routes, malformed bodies, injected 504/429, transaction result codes |
| `__tests__/control.test.js` | The `/_control` endpoint and the failure injection it drives |
| `__tests__/startup.test.js` | The module exports and the `node server.js` entry point |
| `__tests__/helpers/horizon-contract.js` | The shared field lists — the single place to update when Horizon changes a response |

The suite runs in CI as the `mock-horizon` job (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
