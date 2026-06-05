import type { Address, Hex } from "viem";

export type ConfigResponse = {
  chainId: number;
  registry: Address;
  settlement: Address;
csdUsdcSettlement: Address;
  weth: Address;
  usdc: Address;
};

export type TradingSessionAuthorization = {
  grantor: Address;
  executor: Address;
  settlementContract: Address;
  baseToken: Address;
  quoteToken: Address;
  marketId: Hex;
  sideMask: number;
  maxBaseExposure: string;
  maxQuoteExposure: string;
  minPrice: string;
  maxPrice: string;
  validAfter: number;
  validBefore: number;
  authNonce: Hex;
};

export type SignedOrder = {
  trader: Address;
  marketId: Hex;
  side: number;
  orderType: number;
  price: string;
  baseAmount: string;
  timeInForce: number;
  orderNonce: Hex;
  sessionAuthHash: Hex;
  validAfter: number;
  validBefore: number;
};
