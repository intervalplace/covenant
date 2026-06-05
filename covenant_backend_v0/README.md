# Covenant Backend v0

Minimal backend for the Covenant v0 local demo.

It does:
- register signed session authorizations
- register signed orders
- hold an in-memory orderbook
- match one ETH/USDC spot market
- submit matched fills to `CovenantSpotSettlement`
- push WebSocket updates

## Setup

Copy env:

```bash
cp .env.example .env
```

Make sure `.env` matches your latest local Anvil deployment.

Install:

```bash
npm install
```

Run:

```bash
npm run dev
```

Health:

```bash
curl http://127.0.0.1:8787/v1/health
```

This is intentionally minimal: no database, no auth sessions, no production security, no persistence.

Purpose:

> prove the live demo path from signed authorization → signed order → offchain match → authority-bound settlement.
