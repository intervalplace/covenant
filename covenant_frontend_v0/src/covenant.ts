import { parseEther, stringToHex, keccak256, type Address, type Hex } from "viem";
import type { ConfigResponse, SignedOrder, TradingSessionAuthorization } from "./types";

export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8787";

export const MARKET_ID = keccak256(stringToHex("ETH-USDC-SPOT"));

export const AUTH_TYPES = {
  TradingSessionAuthorization: [
    { name: "grantor", type: "address" },
    { name: "executor", type: "address" },
    { name: "settlementContract", type: "address" },
    { name: "baseToken", type: "address" },
    { name: "quoteToken", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "sideMask", type: "uint8" },
    { name: "maxBaseExposure", type: "uint256" },
    { name: "maxQuoteExposure", type: "uint256" },
    { name: "minPrice", type: "uint256" },
    { name: "maxPrice", type: "uint256" },
    { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" },
    { name: "authNonce", type: "bytes32" },
  ],
} as const;

export const ORDER_TYPES = {
  SignedOrder: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "side", type: "uint8" },
    { name: "orderType", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "baseAmount", type: "uint256" },
    { name: "timeInForce", type: "uint8" },
    { name: "orderNonce", type: "bytes32" },
    { name: "sessionAuthHash", type: "bytes32" },
    { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" },
  ],
} as const;

export function domain(chainId: number, verifyingContract: Address) {
  return {
    name: "Covenant",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const r = await fetch(`${BACKEND}/v1/config`);
  if (!r.ok) throw new Error("Failed to fetch config");
  return r.json();
}

export async function postJson(path: string, body: unknown) {
  const r = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || JSON.stringify(j));
  return j;
}

export function randomHex(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

export function buildAuth(params: {
  account: Address;
  cfg: ConfigResponse;
  executor: Address;
  sideMask: number;
  maxEth: string;
  maxUsdc: string;
  minPrice: string;
  maxPrice: string;
  durationSeconds: number;
}): TradingSessionAuthorization {
  const now = Math.floor(Date.now() / 1000);
  return {
    grantor: params.account,
    executor: params.executor,
    settlementContract: params.cfg.settlement,
    baseToken: params.cfg.weth,
    quoteToken: params.cfg.usdc,
    marketId: MARKET_ID,
    sideMask: params.sideMask,
    maxBaseExposure: parseEther(params.maxEth).toString(),
    maxQuoteExposure: parseEther(params.maxUsdc).toString(),
    minPrice: parseEther(params.minPrice).toString(),
    maxPrice: parseEther(params.maxPrice).toString(),
    validAfter: now - 5,
    validBefore: now + params.durationSeconds,
    authNonce: randomHex(),
  };
}

export function buildOrder(params: {
  account: Address;
  side: number;
  price: string;
  amount: string;
  sessionAuthHash: Hex;
  durationSeconds: number;
}): SignedOrder {
  const now = Math.floor(Date.now() / 1000);
  return {
    trader: params.account,
    marketId: MARKET_ID,
    side: params.side,
    orderType: 1,
    price: parseEther(params.price).toString(),
    baseAmount: parseEther(params.amount).toString(),
    timeInForce: 1,
    orderNonce: randomHex(),
    sessionAuthHash: params.sessionAuthHash,
    validAfter: now - 5,
    validBefore: now + params.durationSeconds,
  };
}
