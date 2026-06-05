import type { Address, Hex } from "viem";

export type TradingSessionAuthorization = {
  grantor: Address;
  executor: Address;
  settlementContract: Address;
  baseToken: Address;
  quoteToken: Address;
  marketId: Hex;
  sideMask: number;
  maxBaseExposure: bigint;
  maxQuoteExposure: bigint;
  minPrice: bigint;
  maxPrice: bigint;
  validAfter: number;
  validBefore: number;
  authNonce: Hex;
};

export type SignedOrder = {
  trader: Address;
  marketId: Hex;
  side: number;
  orderType: number;
  price: bigint;
  baseAmount: bigint;
  timeInForce: number;
  orderNonce: Hex;
  sessionAuthHash: Hex;
  validAfter: number;
  validBefore: number;
};

export type StoredAuth = {
  auth: TradingSessionAuthorization;
  signature: Hex;
  authHash: Hex;
  status: "active" | "revoked" | "expired";
};

export type StoredOrder = {
  order: SignedOrder;
  signature: Hex;
  orderHash: Hex;
  status: "open" | "partially_filled" | "filled" | "cancelled" | "expired" | "dead";
  filledBaseAmount: bigint;
  createdAt: number;
};

export type ProposedFill = {
  makerOrderHash: Hex;
  takerOrderHash: Hex;
  makerAuthHash: Hex;
  takerAuthHash: Hex;
  price: bigint;
  baseAmount: bigint;
  quoteAmount: bigint;
  fillNonce: Hex;
};

export type FillRecord = ProposedFill & {
  status: "proposed" | "submitted_for_settlement" | "settled" | "rejected";
  txHash?: Hex;
  error?: string;
  createdAt: number;
};
