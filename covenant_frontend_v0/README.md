# Covenant Frontend v0

Minimal Next.js frontend for the Covenant local demo.

## Setup

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Required running services

1. Anvil running
2. Covenant contracts deployed
3. Covenant backend running at `http://127.0.0.1:8787`

## Wallet setup

Add local Anvil network to MetaMask/Rabby:

- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: `ETH`

Import Anvil accounts:

- Maker account 0
- Taker account 2 or another funded account

Executor is backend account 1.

## Demo flow

1. Connect maker wallet.
2. Approve WETH/USDC.
3. Enable trading.
4. Place sell order.
5. Switch wallet to taker.
6. Approve WETH/USDC.
7. Enable trading.
8. Place matching buy order.
9. Backend matches and submits settlement.
10. Revoke authorization to show the kill switch.

This is intentionally raw. The goal is the live authority-bound execution path.
