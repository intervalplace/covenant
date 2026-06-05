import { keccak256, stringToHex, type Hex } from "viem";
import type { StoredOrder, ProposedFill } from "./types.js";
import { orders, auths } from "./state.js";

export const SIDE_SELL_BASE = 0;
export const SIDE_BUY_BASE = 1;

function isOpen(o: StoredOrder): boolean {
  return o.status === "open" || o.status === "partially_filled";
}

function remaining(o: StoredOrder): bigint {
  return o.order.baseAmount - o.filledBaseAmount;
}

function quoteFor(baseAmount: bigint, price: bigint): bigint {
  return (baseAmount * price) / 10n ** 18n;
}

export function tryMatch(newOrderHash: Hex): ProposedFill | null {
  const incoming = orders.get(newOrderHash);
  if (!incoming || !isOpen(incoming)) return null;

  const incomingAuth = auths.get(incoming.order.sessionAuthHash);
  if (!incomingAuth || incomingAuth.status !== "active") return null;

  const opposite = [...orders.values()]
    .filter((o) => o.orderHash !== newOrderHash)
    .filter(isOpen)
    .filter((o) => o.order.marketId === incoming.order.marketId)
    .filter((o) => o.order.side !== incoming.order.side)

    // Do not self-match same wallet
    .filter((o) => o.order.trader.toLowerCase() !== incoming.order.trader.toLowerCase())

    // Both auths must be active
    .filter((o) => {
      const a = auths.get(o.order.sessionAuthHash);
      return a && a.status === "active";
    })

    // Crossing logic
    .filter((o) => {
      if (incoming.order.side === SIDE_BUY_BASE) return incoming.order.price >= o.order.price;
      return o.order.price >= incoming.order.price;
    })

    // Authorization price-band check at maker price
    .filter((o) => {
      const makerPrice = o.order.price;

      const candidateAuth = auths.get(o.order.sessionAuthHash);
      if (!candidateAuth) return false;

      if (makerPrice < incomingAuth.auth.minPrice || makerPrice > incomingAuth.auth.maxPrice) {
        return false;
      }

      if (makerPrice < candidateAuth.auth.minPrice || makerPrice > candidateAuth.auth.maxPrice) {
        return false;
      }

      return true;
    })

    .sort((a, b) => {
      if (a.order.price === b.order.price) return a.createdAt - b.createdAt;
      if (incoming.order.side === SIDE_BUY_BASE) return Number(a.order.price - b.order.price);
      return Number(b.order.price - a.order.price);
    })[0];

  if (!opposite) return null;

  const maker = opposite;
  const taker = incoming;

if (maker.order.trader.toLowerCase() === taker.order.trader.toLowerCase()) {
  return null;
}

  const baseAmount = remaining(maker) < remaining(taker) ? remaining(maker) : remaining(taker);
  const price = maker.order.price;
  const quoteAmount = quoteFor(baseAmount, price);

  return {
    makerOrderHash: maker.orderHash,
    takerOrderHash: taker.orderHash,
    makerAuthHash: maker.order.sessionAuthHash,
    takerAuthHash: taker.order.sessionAuthHash,
    price,
    baseAmount,
    quoteAmount,
    fillNonce: keccak256(stringToHex(`fill:${maker.orderHash}:${taker.orderHash}:${Date.now()}:${Math.random()}`)),
  };
}
