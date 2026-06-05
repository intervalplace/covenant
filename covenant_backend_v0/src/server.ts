//server.ts
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { auths, orders, fills, serializeBigInts } from "./state.js";
import { tryMatch } from "./matcher.js";
import { executeFill } from "./executor.js";
import type { TradingSessionAuthorization, SignedOrder } from "./types.js";
import { verifyCsdPaymentProof } from "./csdProof.js";
import { getAddress, keccak256, encodeAbiParameters, type Hex, decodeErrorResult } from
"viem";
import { config, publicClient, walletClient } from "./chain.js";
import { settlementAbi, registryAbi, mockErc20Abi, csdUsdcSettlementAbi } from "./abi.js";
import {
validateCsdUsdcSettlementAuthorization,
} from "./csdSettlement.js";
import { db, saveDb } from "./persist.js";
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);
const clients = new Set<any>();
const csdUsdcIntents = new Map<string, any>();
const csdSellIntents = new Map<string, any>();
for (const i of db.data.csdSellIntents) {
csdSellIntents.set(normHash(i.intentHash), i);
}
for (const i of db.data.csdUsdcIntents) {
  csdUsdcIntents.set(normHash(i.intentHash), i);
}
for (const f of db.data.fills) {
fills.set(f.fillNonce, f);
}
async function persistCsdState() {
  db.data.csdSellIntents = jsonSafe([...csdSellIntents.values()]);
  db.data.csdUsdcIntents = jsonSafe([...csdUsdcIntents.values()]);
  db.data.fills = jsonSafe([...fills.values()]);
  await saveDb();
}
function csdPriceWad(usdcAmount: bigint, csdAmount: bigint) {
if (csdAmount === 0n) return 0n;
return (usdcAmount * 100000000n) / csdAmount;
}
function broadcast(type: string, payload: unknown) {
const msg = JSON.stringify(serializeBigInts({ type, payload, ts: Date.now() }));
for (const ws of clients) {
try { ws.send(msg); } catch {}
}
}

function jsonSafe(x: any): any {
  return JSON.parse(
    JSON.stringify(x, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

function errorCode(err: any) {
  try {
    if (err?.data) {
      return decodeErrorResult({
        abi: csdUsdcSettlementAbi,
        data: err.data,
      })?.errorName;
    }
  } catch {}

  return String(
    err?.shortMessage ??
    err?.message ??
    err?.code ??
    "UNKNOWN_ERROR"
  );
}

function now(): number { return Math.floor(Date.now() / 1000); }

const MAX_TRADE_USDC = 50n * 1_000_000n; // 50 USDC, 6 decimals

function normHash(x: string): string {
return x.toLowerCase();
}
function isActiveLockedSellIntent(intent: any): boolean {
return (
intent?.status === "locked_for_settlement" &&
typeof intent.lockExpiresAt === "number" &&
intent.lockExpiresAt > Date.now()
);
}
function releaseExpiredCsdLocks() {
  let changed = false;
  const nowMs = Date.now();

  for (const intent of csdUsdcIntents.values()) {
    if (
      intent.status === "locked_for_settlement" &&
      typeof intent.lockExpiresAt === "number" &&
      intent.lockExpiresAt <= nowMs
    ) {
      changed = true;
      intent.status = "expired_lock";
      intent.expiredAt = nowMs;

      const sellIntent = csdSellIntents.get(
        normHash(intent.authorization.tradeIntentHash)
      );

      if (sellIntent && sellIntent.status === "locked_for_settlement") {
        sellIntent.status = "open";
        sellIntent.lockedByIntentHash = undefined;
        sellIntent.lockedAt = undefined;
        sellIntent.lockExpiresAt = undefined;
      }
    }
  }

  return changed;
}
function findActiveLockForSellIntent(intentHash: string) {
const h = normHash(intentHash);
return [...csdUsdcIntents.values()].find((i) =>
i?.authorization?.tradeIntentHash?.toLowerCase() === h &&
i.status === "locked_for_settlement" &&
typeof i.lockExpiresAt === "number" &&
i.lockExpiresAt > Date.now()
);
}
function asBigIntFields<T extends Record<string, any>>(obj: T, fields: string[]): T {
const copy: any = { ...obj };
for (const f of fields) if (copy[f] !== undefined) copy[f] = BigInt(copy[f]);
return copy;
}
function toContractCsdAuth(auth: any) {
return {
...auth,
csdAmount: BigInt(auth.csdAmount),
usdcAmount: BigInt(auth.usdcAmount),
minConfirmations: BigInt(auth.minConfirmations),
validAfter: BigInt(auth.validAfter),
validBefore: BigInt(auth.validBefore),
};
}
function normalizeCsdUsdcAuth(auth: any) {
return {
buyer: getAddress(auth.buyer),
sellerUsdcRecipient: getAddress(auth.sellerUsdcRecipient),
sellerCsdScriptHash: auth.sellerCsdScriptHash as Hex,
csdGenesisHash: auth.csdGenesisHash as Hex,
tradeIntentHash: auth.tradeIntentHash as Hex,
csdAmount: BigInt(auth.csdAmount),
usdc: getAddress(auth.usdc),
usdcAmount: BigInt(auth.usdcAmount),
minConfirmations: BigInt(auth.minConfirmations),
validAfter: Number(auth.validAfter),
validBefore: Number(auth.validBefore),
nonce: auth.nonce as Hex,
};
}
async function fetchCsdProofByTxid(txid: string) {
const base = process.env.CSD_RPC_URL ?? "http://141.94.163.242:8888";
const res = await fetch(`${base}/proof/tx/${txid}`);
if (!res.ok) {
throw new Error(`CSD_PROOF_FETCH_FAILED_${res.status}`);
}
return await res.json();
}
app.get("/v1/health", async () => ({
ok: true,
chainId: await publicClient.getChainId(),
settlement: config.settlement,
registry: config.registry,
}));

app.get("/v1/csd/utxos/:addr20", async (req, reply) => {
  try {
    const addr20 = (req.params as any).addr20;
    const base = process.env.CSD_RPC_URL ?? "https://explorer.computesubstrate.org";

    const res = await fetch(`${base}/utxos/${addr20}`);
    const json = await res.json();

    return reply.send(jsonSafe(json));
  } catch (err: any) {
    return reply.code(400).send({
      ok: false,
      error: { code: err?.message ?? "CSD_UTXO_FETCH_FAILED" },
    });
  }
});

app.get("/v1/config", async () => serializeBigInts({
chainId: await publicClient.getChainId(),
registry: config.registry,
settlement: config.settlement,
csdUsdcSettlement: config.csdUsdcSettlement,
weth: config.weth,
usdc: config.usdc,
}));
app.get("/v1/markets", async () => ({
markets: [{
marketId: "ETH-USDC-SPOT",
baseToken: config.weth,
quoteToken: config.usdc,
status: "active",
priceScale: "1000000000000000000",
}],
}));
app.get("/v1/book", async () => {
const open = [...orders.values()].filter(o => o.status === "open" || o.status === "partially_filled");
return serializeBigInts({
bids: open.filter(o => o.order.side === 1).map(o => ({ orderHash: o.orderHash, price:
o.order.price, remaining: o.order.baseAmount - o.filledBaseAmount })),
asks: open.filter(o => o.order.side === 0).map(o => ({ orderHash: o.orderHash, price:
o.order.price, remaining: o.order.baseAmount - o.filledBaseAmount })),
});
});
app.get("/v1/csd-book", async () => {
if (releaseExpiredCsdLocks()) {

  await persistCsdState();

}

const open = [...csdSellIntents.values()]
  .filter((i) => i.status === "open")
  .sort((a, b) => {
    const pa = csdPriceWad(a.usdcAmount, a.csdAmount);
    const pb = csdPriceWad(b.usdcAmount, b.csdAmount);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

return serializeBigInts({
asks: open.map((i) => ({
intentHash: i.intentHash,
seller: i.seller,
sellerUsdcRecipient: i.sellerUsdcRecipient,
csdGenesisHash: i.csdGenesisHash,
csdAmount: i.csdAmount,
usdcAmount: i.usdcAmount,
price: csdPriceWad(i.usdcAmount, i.csdAmount),
status: i.status,
createdAt: i.createdAt,
})),
bids: [],
});
});
app.get("/v1/csd-usdc/intents", async () => {
if (releaseExpiredCsdLocks()) {

  await persistCsdState();

}
  return jsonSafe({
    intents: [...csdUsdcIntents.values()],
  });
});
app.get("/v1/session-authorizations", async () => serializeBigInts({ authorizations:
[...auths.values()] }));
app.post("/v1/session-authorizations", async (req) => {
const body = req.body as any;
const auth = asBigIntFields(body.authorization, ["maxBaseExposure", "maxQuoteExposure",
"minPrice", "maxPrice"]) as TradingSessionAuthorization;
auth.grantor = getAddress(auth.grantor);
auth.executor = getAddress(auth.executor);
auth.settlementContract = getAddress(auth.settlementContract);
auth.baseToken = getAddress(auth.baseToken);
auth.quoteToken = getAddress(auth.quoteToken);
const signature = body.signature as Hex;
const authHash = await publicClient.readContract({
address: config.settlement,
abi: settlementAbi,
functionName: "hashTradingSessionAuthorization",
args: [auth as any],
}) as Hex;
await walletClient.writeContract({
address: config.registry,
abi: registryAbi as any,
functionName: "registerAuthorization",
args: [authHash, auth.grantor],
});
const revoked = await publicClient.readContract({
address: config.registry,
abi: registryAbi as any,
functionName: "revokedAuth",
args: [authHash],
}) as boolean;
const status = revoked ? "revoked" : auth.validBefore < now() ? "expired" : "active";
auths.set(authHash, { auth, signature, authHash, status });
broadcast("session_authorization.update", { authHash, status });
return serializeBigInts({ authHash, status });
});
app.post("/v1/session-authorizations/:authHash/revoked", async (req, reply) => {
const authHash = (req.params as any).authHash as Hex;
const auth = auths.get(authHash);
if (auth) auth.status = "revoked";
for (const order of orders.values()) {
if (
order.order.sessionAuthHash.toLowerCase() === authHash.toLowerCase() &&
(order.status === "open" || order.status === "partially_filled")
) {
order.status = "dead";
broadcast("order.update", order);
}
}
broadcast("session_authorization.revoked", { authHash });
broadcast("book.update", null);
return { ok: true };
});
app.post("/v1/orders/:orderHash/cancelled", async (req, reply) => {
const orderHash = (req.params as any).orderHash as Hex;
const order = orders.get(orderHash);
if (!order) {
return reply.code(404).send({
error: { code: "ORDER_NOT_FOUND", message: "Order not found." },
});
}
const cancelled = await publicClient.readContract({
address: config.registry,
abi: registryAbi as any,
functionName: "cancelledOrder",
args: [orderHash],
}) as boolean;
if (!cancelled) {
return reply.code(400).send({
error: {
code: "ORDER_NOT_CANCELLED_ONCHAIN",
message: "Order is not cancelled onchain.",
},
});
}
if (order.status === "open" || order.status === "partially_filled") {
order.status = "cancelled";
broadcast("order.update", order);
broadcast("book.update", null);
}
return { ok: true };
});
app.get("/v1/orders", async () => serializeBigInts({ orders: [...orders.values()] }));
app.post("/v1/orders", async (req, reply) => {
const body = req.body as any;
const order = asBigIntFields(body.order, ["price", "baseAmount"]) as SignedOrder;
order.trader = getAddress(order.trader);
const signature = body.signature as Hex;
const linkedAuth = auths.get(order.sessionAuthHash);
if (!linkedAuth || linkedAuth.status !== "active") {
return reply.code(400).send({
error: {
code: "AUTH_NOT_ACTIVE",
message: "Linked authorization is not active.",
},
});
}
if (linkedAuth.auth.grantor.toLowerCase() !== order.trader.toLowerCase()) {
return reply.code(400).send({
error: {
code: "TRADER_AUTH_MISMATCH",
message: "Order trader does not match authorization grantor.",
},
});
}
const orderHash = (await publicClient.readContract({
address: config.settlement,
abi: settlementAbi,
functionName: "hashSignedOrder",
args: [order as any],
})) as Hex;
await walletClient.writeContract({
address: config.registry,
abi: registryAbi as any,
functionName: "registerOrder",
args: [orderHash, order.trader],
});
orders.set(orderHash, {
order,
signature,
orderHash,
status: "open",
filledBaseAmount: 0n,
createdAt: Date.now(),
});
broadcast("order.update", orders.get(orderHash));
runMatchingLoop(orderHash).catch((err) => {
console.error("matching loop failed", err);
});
return serializeBigInts({ orderHash, status: "open" });
});
async function runMatchingLoop(seedOrderHash: Hex) {
let current: Hex | null = seedOrderHash;
for (let i = 0; i < 20 && current; i++) {
const fill = tryMatch(current);
if (!fill) break;
broadcast("fill.proposed", fill);
const record = await executeFill(fill);
broadcast("fill.update", record);
broadcast("book.update", null);
if (record.status !== "settled") break;
const taker = orders.get(fill.takerOrderHash);
const maker = orders.get(fill.makerOrderHash);
if (taker && (taker.status === "open" || taker.status === "partially_filled")) {
current = taker.orderHash;
} else if (maker && (maker.status === "open" || maker.status === "partially_filled")) {
current = maker.orderHash;
} else {
current = null;
}
}
}

app.post("/v1/csd/proof/submit", async (req, reply) => {
try {
const body = req.body as any;

const result = verifyCsdPaymentProof({
proof: body.csdProof,
expectedRecipientScriptPubKey: body.expectedRecipientScriptPubKey,
expectedAmount: BigInt(body.expectedAmount),
minConfirmations: Number(body.minConfirmations ?? 6),
});
return serializeBigInts({
ok: true,
verified: true,
result,
});
} catch (err: any) {
return reply.code(400).send(jsonSafe({
ok: false,
verified: false,
error: {
code: errorCode(err) || "CSD_PROOF_REJECTED",
},
}));
}
});
app.post("/v1/csd-sell-intents", async (req, reply) => {
try {
const body = req.body as any;

const usdcAmount = BigInt(body.usdcAmount);

if (usdcAmount > MAX_TRADE_USDC) {
  return reply.code(400).send({
    ok: false,
    error: {
      code: "TRADE_SIZE_CAP_EXCEEDED",
      message: "CSD/USDC trades are currently capped at 50 USDC.",
    },
  });
}

const intentHash = keccak256(
encodeAbiParameters(
[
{ name: "seller", type: "address" },
{ name: "sellerUsdcRecipient", type: "address" },
{ name: "csdGenesisHash", type: "bytes32" },
{ name: "csdAmount", type: "uint256" },
{ name: "usdcAmount", type: "uint256" },
],
[
getAddress(body.seller),
getAddress(body.sellerUsdcRecipient),
body.csdGenesisHash as Hex,
BigInt(body.csdAmount),
usdcAmount,
]
)
);
const intent = {
intentHash,
seller: getAddress(body.seller),
sellerUsdcRecipient: getAddress(body.sellerUsdcRecipient),
csdGenesisHash: body.csdGenesisHash as Hex,
csdAmount: BigInt(body.csdAmount),
usdcAmount,
createdAt: Date.now(),
status: "open",
};
csdSellIntents.set(normHash(intentHash), intent);
await persistCsdState();
broadcast("csd_sell_intent.created", intent);
return jsonSafe({
  ok: true,
  intent,
});
} catch (err: any) {
return reply.code(400).send(jsonSafe({
  ok: false,
  error: {
    code: errorCode(err) || "CSD_SELL_INTENT_REJECTED",
  },
}));
}
});
app.post("/v1/csd-sell-intents/:intentHash/cancel", async (req, reply) => {
const intentHash = normHash((req.params as any).intentHash as string);
const body = req.body as any;
const intent = csdSellIntents.get(intentHash);
if (!intent) {
return reply.code(404).send({
ok: false,
error: { code: "SELL_INTENT_NOT_FOUND" },
});
}
if (intent.seller.toLowerCase() !== getAddress(body.seller).toLowerCase()) {
return reply.code(403).send({
ok: false,
error: { code: "NOT_SELLER" },
});
}
const activeLock = findActiveLockForSellIntent(intentHash);
if (isActiveLockedSellIntent(intent) || activeLock) {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_LOCKED_FOR_SETTLEMENT" },
});
}
if (intent.status === "locked_for_settlement" && intent.lockExpiresAt <= Date.now()) {
intent.status = "open";
intent.lockedByIntentHash = undefined;
intent.lockedAt = undefined;
intent.lockExpiresAt = undefined;
}
if (intent.status !== "open") {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_NOT_OPEN" },
});
}
intent.status = "cancelled";
intent.cancelledAt = Date.now();
await persistCsdState();
broadcast("csd_sell_intent.cancelled", { intentHash });
return serializeBigInts({
ok: true,
intentHash,
status: "cancelled",
});
});
app.post("/v1/csd-usdc/intent", async (req, reply) => {
try {
const body = req.body as any;
const auth = normalizeCsdUsdcAuth(body.authorization);

if (auth.usdcAmount > MAX_TRADE_USDC) {
  return reply.code(400).send({
    ok: false,
    error: {
      code: "TRADE_SIZE_CAP_EXCEEDED",
      message: "CSD/USDC trades are currently capped at 50 USDC.",
    },
  });
}

const authorizationSignature = body.authorizationSignature as Hex;
validateCsdUsdcSettlementAuthorization(auth);
const sellIntent = csdSellIntents.get(normHash(auth.tradeIntentHash));
if (!sellIntent || sellIntent.status !== "open") {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_NOT_FOUND" },
});
}
if (
sellIntent.sellerUsdcRecipient.toLowerCase() !== auth.sellerUsdcRecipient.toLowerCase() ||
sellIntent.csdGenesisHash.toLowerCase() !== auth.csdGenesisHash.toLowerCase() ||
sellIntent.csdAmount !== auth.csdAmount ||
sellIntent.usdcAmount !== auth.usdcAmount
) {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_AUTH_MISMATCH" },
});
}
const intentHash = await publicClient.readContract({
address: config.csdUsdcSettlement,
abi: csdUsdcSettlementAbi,
functionName: "hashCsdUsdcAuthorization",
args: [auth as any],
}) as Hex;



await walletClient.writeContract({
address: config.registry,
abi: registryAbi as any,
functionName: "registerAuthorization",
args: [intentHash, auth.buyer],
});
csdUsdcIntents.set(intentHash, {
  intentHash,
  seller: sellIntent.seller,
  authorization: auth,
  authorizationSignature,
  expectedRecipientScriptPubKey: body.expectedRecipientScriptPubKey,
  status: "pending_csd_payment",
  createdAt: Date.now(),
});
await persistCsdState();
broadcast("csd_usdc.intent.created", { intentHash });
return jsonSafe({
  ok: true,
  intentHash,
  authorization: auth,
  status: "pending_csd_payment",
});
} catch (err: any) {
console.error("[csd-usdc/intent] failed", {
shortMessage: err?.shortMessage,
message: err?.message,
cause: err?.cause,
data: err?.data,
details: err?.details,
});
return reply.code(400).send(jsonSafe({
ok: false,
error: {
code: errorCode(err) || "CSD_USDC_INTENT_REJECTED",
},
}));
}
});
app.post("/v1/csd-usdc/lock", async (req, reply) => {
if (releaseExpiredCsdLocks()) {

  await persistCsdState();

}
try {
const body = req.body as any;
const intentHash = normHash(body.intentHash as string);

const seller = body.seller ? getAddress(body.seller) : null;

const lockExpiresAt = Date.now() + 10 * 60 * 1000;
const intent = csdUsdcIntents.get(intentHash);



if (!intent) {
return reply.code(404).send({
ok: false,
error: { code: "INTENT_NOT_FOUND" },
});
}

if (!seller || intent.seller?.toLowerCase() !== seller.toLowerCase()) {
  return reply.code(403).send({
    ok: false,
    error: { code: "ONLY_SELLER_CAN_LOCK_SETTLEMENT" },
  });
}

if (intent.status !== "pending_csd_payment") {
return reply.code(400).send({
ok: false,
error: { code: "INTENT_NOT_LOCKABLE" },
});
}

const buyerUsdcBalance = await publicClient.readContract({
  address: intent.authorization.usdc,
  abi: mockErc20Abi as any,
  functionName: "balanceOf",
  args: [intent.authorization.buyer],
}) as bigint;

if (buyerUsdcBalance < BigInt(intent.authorization.usdcAmount)) {
  return reply.code(400).send({
    ok: false,
    error: { code: "BUYER_USDC_BALANCE_TOO_LOW" },
  });
}

const buyerUsdcAllowance = await publicClient.readContract({
  address: intent.authorization.usdc,
  abi: mockErc20Abi as any,
  functionName: "allowance",
  args: [intent.authorization.buyer, config.csdUsdcSettlement],
}) as bigint;

if (buyerUsdcAllowance < BigInt(intent.authorization.usdcAmount)) {
  return reply.code(400).send({
    ok: false,
    error: { code: "BUYER_USDC_ALLOWANCE_TOO_LOW" },
  });
}

console.log("[lock preflight]", {
  intentHash,
  buyer: intent.authorization.buyer,
  seller: intent.seller,
  authUsdc: intent.authorization.usdc,
  cfgUsdc: config.usdc,
  spender: config.csdUsdcSettlement,
  usdcAmount: intent.authorization.usdcAmount.toString(),
  buyerUsdcBalance: buyerUsdcBalance.toString(),
  buyerUsdcAllowance: buyerUsdcAllowance.toString(),
  chainId: await publicClient.getChainId(),
});

const txHash = await walletClient.writeContract({
  address: config.csdUsdcSettlement,
  abi: csdUsdcSettlementAbi,
  functionName: "lockCsdUsdcAuthorization",
  args: [toContractCsdAuth(intent.authorization) as any, intent.authorizationSignature],
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

if (receipt.status !== "success") {
  return reply.code(400).send({
    ok: false,
    error: { code: "LOCK_TX_REVERTED" },
  });
}

const onchainLocked = await publicClient.readContract({
  address: config.csdUsdcSettlement,
  abi: csdUsdcSettlementAbi,
  functionName: "lockedBalance",
  args: [intentHash as Hex],
}) as bigint;

if (onchainLocked === 0n) {
  return reply.code(400).send({
    ok: false,
    error: { code: "LOCK_NOT_CONFIRMED_ONCHAIN" },
  });
}
const sellIntentHash = normHash(intent.authorization.tradeIntentHash);
const sellIntent = csdSellIntents.get(sellIntentHash);
if (!sellIntent) {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_NOT_FOUND" },
});
}
if (sellIntent.status !== "open") {
return reply.code(400).send({
ok: false,
error: { code: "SELL_INTENT_NOT_OPEN" },
});
}
sellIntent.status = "locked_for_settlement";
sellIntent.lockedByIntentHash = intentHash;
sellIntent.lockedAt = Date.now();
sellIntent.lockExpiresAt = lockExpiresAt;
intent.status = "locked_for_settlement";
intent.lockTxHash = txHash;
intent.lockedAt = Date.now();
intent.lockExpiresAt = lockExpiresAt;
await persistCsdState();
broadcast("csd_usdc.intent.locked", jsonSafe({
  intentHash,
  txHash,
  expectedRecipientScriptPubKey: intent.expectedRecipientScriptPubKey,
  csdAmount: intent.authorization.csdAmount,
}));
return reply.send(jsonSafe({
  ok: true,
  status: "locked_for_settlement",
  intentHash,
  txHash,
  lockExpiresAt,
  lockedBalance: onchainLocked,
}));
} catch (err: any) {
  return reply.code(400).send(jsonSafe({
    ok: false,
    error: {
      code: errorCode(err) || "CSD_USDC_LOCK_REJECTED",
    },
  }));
}
});

app.get("/v1/csd-usdc/lock/:intentHash", async (req) => {
  const intentHash = normHash((req.params as any).intentHash);
  const intent = csdUsdcIntents.get(intentHash);

  let authHash = intentHash as Hex;

  if (intent) {
    authHash = await publicClient.readContract({
      address: config.csdUsdcSettlement,
      abi: csdUsdcSettlementAbi,
      functionName: "hashCsdUsdcAuthorization",
      args: [toContractCsdAuth(intent.authorization) as any],
    }) as Hex;
  }

  const locked = await publicClient.readContract({
    address: config.csdUsdcSettlement,
    abi: csdUsdcSettlementAbi,
    functionName: "lockedBalance",
    args: [authHash],
  }) as bigint;

  console.log("[locked read]", {
    requested: intentHash,
    recomputedAuthHash: authHash,
    locked: locked.toString(),
    foundIntent: !!intent,
  });

  return jsonSafe({
    requested: intentHash,
    authHash,
    lockedBalance: locked,
    active: locked > 0n,
  });
});

app.post("/v1/csd-usdc/refund", async (req, reply) => {
  try {
    const body = req.body as any;

const intentHash = normHash(body.intentHash as string);
const intent = csdUsdcIntents.get(intentHash);

    if (!intent) {
      return reply.code(404).send({
        ok: false,
        error: {
          code: "INTENT_NOT_FOUND",
        },
      });
    }

    if (intent.status !== "expired_lock") {
      return reply.code(400).send({
        ok: false,
        error: {
          code: "LOCK_NOT_EXPIRED",
        },
      });
    }

    const txHash = await walletClient.writeContract({
      address: config.csdUsdcSettlement,
      abi: csdUsdcSettlementAbi,
      functionName: "refundExpiredLock",
      args: [
        toContractCsdAuth(intent.authorization),
      ],
    });

    intent.status = "expired_refunded";
    intent.refundTxHash = txHash;

    await persistCsdState();

    return {
      ok: true,
      txHash,
      status: "expired_refunded",
    };
  } catch (err: any) {
    return reply.code(400).send({
      ok: false,
      error: {
        code:
          err?.shortMessage ??
          err?.message ??
          "REFUND_FAILED",
      },
    });
  }
});

app.post("/v1/csd-usdc/settle-by-txid", async (req, reply) => {
if (releaseExpiredCsdLocks()) {

  await persistCsdState();

}
try {
const body = req.body as any;
const intentHash = normHash(body.intentHash as string);
const csdTxid = body.csdTxid as string;
if (!intentHash) {
return reply.code(400).send({
ok: false,
error: { code: "MISSING_INTENT_HASH" },
});
}
if (!csdTxid) {
return reply.code(400).send({
ok: false,
error: { code: "MISSING_CSD_TXID" },
});
}
const proof = await fetchCsdProofByTxid(csdTxid);
const settleRes = await app.inject({
method: "POST",
url: "/v1/csd-usdc/settle",
payload: {
intentHash,
csdProof: proof,
},
});
const json = JSON.parse(settleRes.body);
return reply.code(settleRes.statusCode).send(json);
} catch (err: any) {
return reply.code(400).send(jsonSafe({
ok: false,
error: {
code: errorCode(err) || "CSD_SETTLE_BY_TXID_FAILED",
},
}));
}
});
app.post("/v1/csd-usdc/settle", async (req, reply) => {
try {
const body = req.body as any;
const intentHash = normHash(body.intentHash as string);
const intent = csdUsdcIntents.get(intentHash);
if (!intent) {
return reply.code(404).send({
ok: false,
error: { code: "INTENT_NOT_FOUND" },
});
}
const auth = intent.authorization;
const authSig = intent.authorizationSignature as Hex;

const authHash = await publicClient.readContract({
  address: config.csdUsdcSettlement,
  abi: csdUsdcSettlementAbi,
  functionName: "hashCsdUsdcAuthorization",
  args: [toContractCsdAuth(intent.authorization) as any],
}) as Hex;

const onchainLocked = await publicClient.readContract({
  address: config.csdUsdcSettlement,
  abi: csdUsdcSettlementAbi,
  functionName: "lockedBalance",
  args: [authHash],
}) as bigint;

if (onchainLocked === 0n) {
  return reply.code(400).send({
    ok: false,
    error: { code: "USDC_NOT_LOCKED_DO_NOT_SEND_CSD" },
  });
}

const proofResult = verifyCsdPaymentProof({
proof: body.csdProof,
expectedRecipientScriptPubKey: intent.expectedRecipientScriptPubKey,
expectedAmount: BigInt(auth.csdAmount),
minConfirmations: Number(auth.minConfirmations),
});
const proof = {
csdTxid: proofResult.txid,
sellerCsdScriptHash: auth.sellerCsdScriptHash,
csdGenesisHash: proofResult.genesisHash,
tradeIntentHash: auth.tradeIntentHash,
csdAmount: BigInt(auth.csdAmount),
confirmations: BigInt(proofResult.confirmations),
blockHash: proofResult.blockHash,
blockHeight: BigInt(proofResult.height),
};
const txHash = await walletClient.writeContract({
address: config.csdUsdcSettlement,
abi: csdUsdcSettlementAbi,
functionName: "settleCsdUsdc",
args: [toContractCsdAuth(auth) as any, authSig, proof as any],
});
intent.status = "settled";
intent.txHash = txHash;
const sellIntent = csdSellIntents.get(normHash(auth.tradeIntentHash));
if (sellIntent) {
sellIntent.status = "settled";
sellIntent.csdTxid = proofResult.txid;
sellIntent.settlementTxHash = txHash;
}
(fills as any).set(intentHash as Hex, {
marketId: "CSD-USDC",
fillNonce: intentHash as Hex,
baseAmount: auth.csdAmount,
quoteAmount: auth.usdcAmount,
price: csdPriceWad(auth.usdcAmount, auth.csdAmount),
status: "settled",
txHash,
settledAt: Date.now(),
csdTxid: proofResult.txid,
sellerUsdcRecipient: auth.sellerUsdcRecipient,
buyer: auth.buyer,
});
await persistCsdState();
broadcast("csd_usdc.intent.settled", { intentHash, txHash });
return serializeBigInts({
ok: true,
status: "settled",
intentHash,
auth,
proof,
txHash,
});
} catch (err: any) {
return reply.code(400).send({
ok: false,
error: {
code:
err?.data
? decodeErrorResult({ abi: csdUsdcSettlementAbi, data: err.data })?.errorName
: err?.shortMessage ?? err?.message ?? "CSD_USDC_SETTLEMENT_REJECTED",
},
});
}
});
app.get("/v1/markets/:marketId/trades", async (req) => {
const marketId = (req.params as any).marketId;
return serializeBigInts({
trades: [...fills.values()]
.filter((f: any) => marketId === "CSD-USDC")
.sort((a: any, b: any) => Number(b.settledAt ?? 0) - Number(a.settledAt ?? 0)),
});
});
app.get("/v1/fills", async () => serializeBigInts({ fills: [...fills.values()] }));
app.register(async function (fastify) {
fastify.get("/v1/ws", { websocket: true }, (connection) => {
clients.add(connection.socket);
connection.socket.on("close", () => clients.delete(connection.socket));
connection.socket.send(JSON.stringify({ type: "connected", ts: Date.now() }));
});
});

app.listen({ port: config.port, host: "0.0.0.0" });
