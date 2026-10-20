# 🗺 Stellar MicroPay — Roadmap

This roadmap reflects the code currently in the repository. Items are categorized as shipped, in progress, or not started based on the implementation that exists today.

Last reviewed: 2026-10-20

## Status legend

- Shipped: implemented and checked in to the repo
- In progress: partly implemented, active work, or still missing critical persistence / production hardening
- Not started: not implemented in the current codebase

---

## ✅ Shipped features

| Area | Status | Evidence |
| --- | --- | --- |
| Wallet connection and dashboard | Shipped | [frontend/pages/dashboard.tsx](frontend/pages/dashboard.tsx), [frontend/components/WalletConnect.tsx](frontend/components/WalletConnect.tsx) |
| Basic payment sending | Shipped | [frontend/components/SendPaymentForm.tsx](frontend/components/SendPaymentForm.tsx), [frontend/lib/stellar.ts](frontend/lib/stellar.ts) |
| Payment history / recent activity | Shipped | [frontend/components/TransactionList.tsx](frontend/components/TransactionList.tsx), [frontend/pages/dashboard.tsx](frontend/pages/dashboard.tsx) |
| Creator tips and public tip pages | Shipped | [frontend/pages/tip/[username].tsx](frontend/pages/tip/[username].tsx), [frontend/components/TipWidget.tsx](frontend/components/TipWidget.tsx), [backend/src/routes/tips.js](backend/src/routes/tips.js) |
| Tip leaderboard and opt-out controls | Shipped | [backend/src/routes/tips.js](backend/src/routes/tips.js), [frontend/pages/leaderboard.tsx](frontend/pages/leaderboard.tsx), [frontend/components/LeaderboardPrivacyToggle.tsx](frontend/components/LeaderboardPrivacyToggle.tsx) |
| Creator tips dashboard | Shipped | [frontend/components/CreatorTipsDashboard.tsx](frontend/components/CreatorTipsDashboard.tsx) |
| Soroban payment streams | Shipped | [frontend/pages/streams.tsx](frontend/pages/streams.tsx), [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) |
| Multi-signature transaction flow | Shipped | [frontend/components/MultiSigFlow.tsx](frontend/components/MultiSigFlow.tsx), [frontend/pages/multi-sig-sign.tsx](frontend/pages/multi-sig-sign.tsx) |
| Scheduled / recurring payments | Shipped | [frontend/pages/scheduled-payments.tsx](frontend/pages/scheduled-payments.tsx), [backend/src/services/turretsService.js](backend/src/services/turretsService.js) |
| Soroban escrow and milestone escrow | Shipped | [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) |
| Batch tip payments | Shipped | [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) |
| Admin fee controls (bps, max 500) | Shipped | [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) |
| Receipt minting and lookup | Shipped | [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) |
| Developer experience & CI | Shipped | [docker-compose.yml](docker-compose.yml), [.github/workflows/ci.yml](.github/workflows/ci.yml), test suites |

### Notable shipped functionality

- Payment streams: contract entry points include `open_stream`, `claim_stream`, `top_up_stream`, `close_stream`, `pause_stream`, and `resume_stream` in [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs).
- Tips: sender-authorized tip flows and payer receipt tracking are implemented in [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs), while public app and API support live in [frontend/pages/tip/[username].tsx](frontend/pages/tip/[username].tsx) and [backend/src/routes/tips.js](backend/src/routes/tips.js).
- Scheduled payments: recurring DCA-style flows are surfaced in [frontend/pages/scheduled-payments.tsx](frontend/pages/scheduled-payments.tsx) and backed by Turrets helpers.
- Multi-sig: the wallet workflow exists as a first-class UI in [frontend/components/MultiSigFlow.tsx](frontend/components/MultiSigFlow.tsx).

---

## 🔄 In progress / open gaps

These items are not complete or are still missing production-grade persistence.

| Area | Status | Notes |
| --- | --- | --- |
| Persistent storage for app data | In progress | The backend tip service currently stores creator tip data in memory rather than durable storage; this is a real gap for production resilience. See [backend/src/services/tipsService.js](backend/src/services/tipsService.js). |
| Production-ready backup / recovery for on-chain and app state | In progress | Needs durable persistence, export, and restore flows for creator data, scheduled jobs, and event state. |
| Full batch payment v2.0 implementation | In progress | [contracts/stellar-micropay-contract/src/lib.rs](contracts/stellar-micropay-contract/src/lib.rs) still contains the placeholder `batch_send` stub; the real implementation is not yet shipped. |
| Cross-chain / multi-currency support | In progress | Multi-currency and asset conversion work is still deferred relative to the current codebase. |

> The project is no longer “v1.0 only” or “future state only”; the repo already contains the shipped features above, and the remaining work is mostly durability, polish, and the unimplemented batch-payment follow-up.

---

## 🚧 Not started

| Feature | Status | Notes |
| --- | --- | --- |
| Username registry / human-readable handle mapping | Not started | No username resolver or wallet mapping is implemented in the repo yet. |
| QR code payment generation / deep links | Not started | No wallet QR flow or deep-linking feature exists in the app yet. |
| Payment request links | Not started | No shareable payment-request generator is wired as a first-class flow. |
| Advanced analytics export | Not started | No CSV export or richer analytics dashboard is shipped. |
| Native USDC / multi-asset conversion flow | Not started | Not yet implemented in the current codebase. |
| Full persistent backend for all live workflow state | Not started | Durable storage for tips, scheduled jobs, and similar live data is still a gap. |

---

## 🎯 Roadmap by milestone

### v1.0 — Foundation

Status: Shipped

- Wallet connection and basic payment flows
- Transaction history and dashboard UI
- Basic backend and contract scaffolding

### v1.1 — Creator monetization

Status: Shipped

- Public tip pages and creator profiles
- Tip submission and receipt recording
- Creator dashboard and leaderboard

### v1.2 — Streams and recurring payments

Status: Shipped

- Soroban stream lifecycle management
- Scheduled payment flows and Turrets integration

### v1.3 — Escrow and risk controls

Status: Shipped

- Time-locked escrow
- Milestone escrow and dispute flows
- Admin fee controls and operator config

### v1.4 — Batch payments and production hardening

Status: In progress

- Finish the real multi-recipient batch payment implementation
- Replace in-memory app state with durable persistence
- Harden production deployments and operational resilience

### v2.0 — Wider asset / payment features

Status: Not started

- QR payment flows
- Usernames and human-readable payment routing
- Multi-currency asset support
- Advanced analytics and exports

---

## 💬 Contributing

Open an issue or start a discussion for the remaining open items. The biggest remaining work is not a blank roadmap but production hardening and a few unimplemented features such as the actual batch-payment engine and durable persistence.

See [CONTRIBUTING.md](CONTRIBUTING.md) to begin.
