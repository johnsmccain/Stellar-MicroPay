# Environment Variables Reference

## Secrets Convention: \*\_FILE Variables

The backend supports both plain environment variables and Docker-style \*\_FILE variables for sensitive configuration. This allows secrets to be mounted as files (e.g. from Docker Secrets or Kubernetes mounted volumes) without appearing in the environment or process inspection.

### How It Works

For each secret variable, the backend checks:

1. **Plain variable first** (e.g. `JWT_SECRET`) — if set, this value is used
2. **File-based variable second** (e.g. `JWT_SECRET_FILE`) — if plain is not set, the backend reads the file path

**Precedence:** Plain variables take precedence over \*\_FILE variables for backwards compatibility.

### Production Secrets

Three secrets are required for production startup:

#### JWT_SECRET / JWT_SECRET_FILE

- **Purpose:** Sign authentication tokens
- **Generation:** `openssl rand -base64 32`
- **Plain variable:** `export JWT_SECRET="..."`
- **File variable:** `export JWT_SECRET_FILE="/run/secrets/jwt_secret"`

#### SERVER_PRIVATE_KEY / SERVER_PRIVATE_KEY_FILE

- **Purpose:** Stellar account private key for signing transactions
- **Requirements:** Must be a valid Stellar secret key (starts with `S`)
- **Plain variable:** `export SERVER_PRIVATE_KEY="SBXXXXXX..."`
- **File variable:** `export SERVER_PRIVATE_KEY_FILE="/run/secrets/server_private_key"`

#### PAYMENT_SIGNING_SECRET / PAYMENT_SIGNING_SECRET_FILE

- **Purpose:** Shared secret for verifying payment submission requests
- **Generation:** `openssl rand -hex 32`
- **Plain variable:** `export PAYMENT_SIGNING_SECRET="..."`
- **File variable:** `export PAYMENT_SIGNING_SECRET_FILE="/run/secrets/payment_signing_secret"`

### Docker Compose Example

Using Docker Secrets with \*\_FILE variables:

```yaml
services:
  backend:
    environment:
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
      - SERVER_PRIVATE_KEY_FILE=/run/secrets/server_private_key
      - PAYMENT_SIGNING_SECRET_FILE=/run/secrets/payment_signing_secret
    secrets:
      - jwt_secret
      - server_private_key
      - payment_signing_secret

secrets:
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  server_private_key:
    file: ./secrets/server_private_key.txt
  payment_signing_secret:
    file: ./secrets/payment_signing_secret.txt
```

### Kubernetes Example

Using mounted secrets:

```yaml
env:
  - name: JWT_SECRET_FILE
    value: /var/run/secrets/jwt_secret
  - name: SERVER_PRIVATE_KEY_FILE
    value: /var/run/secrets/server_private_key
  - name: PAYMENT_SIGNING_SECRET_FILE
    value: /var/run/secrets/payment_signing_secret
volumeMounts:
  - name: jwt-secret
    mountPath: /var/run/secrets/jwt_secret
    subPath: jwt_secret
  - name: key-secret
    mountPath: /var/run/secrets/server_private_key
    subPath: server_private_key
  - name: payment-secret
    mountPath: /var/run/secrets/payment_signing_secret
    subPath: payment_signing_secret
```

### File Format

Secret files should contain:

- The secret value as plain text
- Optional trailing whitespace (automatically trimmed)
- No additional formatting or encoding

Example:

```bash
# Create jwt_secret.txt
echo -n "$(openssl rand -base64 32)" > secrets/jwt_secret.txt
```

### Error Messages

If secrets are missing at startup, you'll see clear errors:

```
Environment validation failed:

  - JWT_SECRET is required in production — set JWT_SECRET or JWT_SECRET_FILE. Used to sign authentication tokens. Generate with: openssl rand -base64 32
  - SERVER_PRIVATE_KEY is required in production — set SERVER_PRIVATE_KEY or SERVER_PRIVATE_KEY_FILE. The Stellar account private key used to sign payment transactions. Must be a valid Stellar secret key (starts with S)
  - PAYMENT_SIGNING_SECRET is required in production — set PAYMENT_SIGNING_SECRET or PAYMENT_SIGNING_SECRET_FILE. Generate with: openssl rand -hex 32
```

### Security Notes

- Never commit actual secret values to the repository
- Use `.gitignore` to exclude secret files
- Rotate secrets periodically
- In production clusters, use a secrets manager (HashiCorp Vault, AWS Secrets Manager, Kubernetes Secrets, etc.)
- The backend only reads secrets at startup; changing secret files requires a restart

## Web Push Notifications (PWA)

The backend can send Web Push notifications for incoming payments (see
`docs/pwa.md` → "Push Notifications" for the full architecture). The
following variables configure it:

### VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY

- **Purpose:** VAPID keypair identifying this push server to the browser's push service
- **Generation:** `npx web-push generate-vapid-keys` (returns a `publicKey` / `privateKey` pair)
- **Plain variables:** `export VAPID_PUBLIC_KEY="..."` / `export VAPID_PRIVATE_KEY="..."`
- **Notes:** The public key must match `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the
  frontend build (the browser refuses a `PushManager.subscribe()` call whose
  `applicationServerKey` doesn't match the sender). Without both keys the
  backend logs no error — sending becomes a no-op
  (`backend/src/services/pushService.js` → `isPushConfigured()`).

### VAPID_CONTACT

- **Purpose:** Contact URI sent to the push service in VAPID `mailto:`/`https:` claims
- **Default:** `mailto:admin@stellarmicropay.com`
- **Plain variable:** `export VAPID_CONTACT="mailto:you@example.com"`

### Frontend counterparts (frontend/.env.local)

- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`** — must equal `VAPID_PUBLIC_KEY`; used by
  `PushManager.subscribe()` on the Dashboard's "Enable payment notifications"
  toggle. When unset, the toggle still enables in-app notifications but never
  registers a server subscription.
- **`NEXT_PUBLIC_API_URL`** — base URL the browser uses to POST the
  subscription to `/api/push/subscribe` (defaults to the same origin).
- Both are documented with comments in `frontend/.env.example`.

## Backend Startup Environment Inventory

`backend/src/config/env.js` owns the backend defaults. The server loads
`backend/.env` and validates configuration before loading routes or services.
The inventory below accounts for all 40 accepted environment keys: 37 directly
named runtime variables plus the three secret `_FILE` names read dynamically.
Only `JWT_SECRET`, `SERVER_PRIVATE_KEY`, and `PAYMENT_SIGNING_SECRET` are
required in production. Their `*_FILE` variants are accepted for mounted
secrets: `JWT_SECRET_FILE`, `SERVER_PRIVATE_KEY_FILE`, and
`PAYMENT_SIGNING_SECRET_FILE`. In development and tests, JWT and payment-signing
secrets use test-only fallbacks, and a SEP-10 server key is generated
ephemerally when used.

| Variable(s) | Classification | Default or behavior |
| --- | --- | --- |
| `NODE_ENV` | Optional, validated | `development`; accepts `development`, `test`, `production` |
| `STELLAR_NETWORK` | Optional, validated | `testnet`; accepts `testnet` or `mainnet` |
| `PORT` | Optional, validated | `4000` |
| `TURRETS_PORT` | Optional, validated | `4100` |
| `HORIZON_URL` | Optional, validated | Network-specific Horizon URL; takes precedence over legacy `STELLAR_HORIZON_URL` |
| `STELLAR_HORIZON_URL` | Optional alias | Used only when `HORIZON_URL` is unset |
| `SOROBAN_RPC_URL` | Optional, validated | Network-specific Soroban RPC URL |
| `CONTRACT_ID`, `SOROBAN_CONTRACT_ID`, `NEXT_PUBLIC_CONTRACT_ID` | Optional aliases | First set value is used; empty disables contract event streaming |
| `EVENTS_POLL_INTERVAL_MS` | Optional, validated | `5000` ms |
| `EVENT_POLL_INTERVAL_MS` | Optional legacy alias | Used only when `EVENTS_POLL_INTERVAL_MS` is unset |
| `EVENTS_HEARTBEAT_INTERVAL_MS` | Optional, validated | `15000` ms |
| `EVENTS_LEDGER_LOOKBACK` | Optional, validated | `20` ledgers |
| `DOMAIN` | Optional | `stellarmicropay.com` |
| `HOME_DOMAIN` | Optional | `DOMAIN`, then `localhost:4000` |
| `JWT_SECRET` | Required in production | Authentication signing secret; `_FILE` form supported |
| `SERVER_PRIVATE_KEY` | Required in production | Stellar server signing key; `_FILE` form supported; generated ephemerally in development/test |
| `PAYMENT_SIGNING_SECRET` | Required in production | Payment request-signature key; `_FILE` form supported |
| `CSRF_SECRET` | Optional | `JWT_SECRET`, then a local fallback |
| `ALLOWED_ORIGINS` | Optional | `http://localhost:3000`; comma-separated CORS origins |
| `LOG_LEVEL` | Optional, validated | `info` (`silent` in tests); Pino levels `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `METRICS_ENABLED` | Optional | Disabled; set to `true` to expose `/metrics` |
| `ADMIN_PUBLIC_KEYS` | Optional | Empty; comma-separated keys grant analytics admin access |
| `ANTHROPIC_API_KEY` | Optional | Empty; AI parsing responds in degraded mode |
| `REDIS_URL` | Optional, validated | Unset disables Redis and uses in-memory cache; accepts `redis://` or `rediss://` |
| `ANALYTICS_CACHE_TTL_MS` | Optional, validated | `300000` ms |
| `ANALYTICS_CACHE_MAX_ENTRIES` | Optional, validated | `500` entries |
| `TURRETS_EVALUATION_INTERVAL_MS` | Optional, validated | `30000` ms |
| `TURRETS_SIGNER_ADDRESS` | Optional | Empty; an ephemeral signer address is generated |
| `USDC_ISSUER` | Optional | Configured public issuer; comma-separated issuer list is accepted |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional pair, validated | Both unset disables Web Push; set both to enable it |
| `VAPID_CONTACT` | Optional, validated | `mailto:admin@stellarmicropay.com`; accepts `mailto:` or `https://` |
| `USERNAMES_DATA_FILE` | Optional | `backend/data/usernames.json` |
| `SCHEDULED_TX_DATA_FILE` | Optional | `backend/data/scheduled_transactions.json` |
| `LEADERBOARD_OPTOUT_DATA_FILE` | Optional | `backend/data/leaderboard-opt-out.json` |

All configured numeric values must be positive integers; the two ports must be
in the range 1–65535. Invalid values, invalid URLs, unsupported network/runtime
names, invalid log levels, and incomplete VAPID key pairs produce actionable
startup errors. `EVENT_POLL_INTERVAL_MS` and `STELLAR_HORIZON_URL` remain
supported for backwards compatibility; use their canonical counterparts for
new deployments.
