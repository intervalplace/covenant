//page.tsx
"use client";
import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import {
  formatEther,
  formatUnits,
  maxUint256,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { injected } from "wagmi/connectors";
import {
  AUTH_TYPES,
  BACKEND,
  ORDER_TYPES,
  buildAuth,
  buildOrder,
  domain,
  fetchConfig,
  postJson,
} from "../src/covenant";
import type { ConfigResponse, TradingSessionAuthorization } from "../src/types";
import { erc20Abi, registryAbi } from "../src/abi";
import Link from "next/link";

type Log = { ts: number; text: string };

const CSD_USDC_TYPES = {
  CsdUsdcAuthorization: [
    { name: "buyer", type: "address" },
    { name: "sellerUsdcRecipient", type: "address" },
    { name: "sellerCsdScriptHash", type: "bytes32" },
    { name: "csdGenesisHash", type: "bytes32" },
    { name: "tradeIntentHash", type: "bytes32" },
    { name: "csdAmount", type: "uint256" },
    { name: "usdc", type: "address" },
    { name: "usdcAmount", type: "uint256" },
    { name: "minConfirmations", type: "uint256" },
    { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

function short(x?: string) {
  if (!x) return "";
  return `${x.slice(0, 8)}...${x.slice(-6)}`;
}

function safeBigInt(x: string | bigint | number | null | undefined) {
  try {
    if (x === null || x === undefined || x === "") return 0n;
    return BigInt(x);
  } catch {
    return 0n;
  }
}

function safeBaseUnits8(v:any){
  try{
    return BigInt(v).toString();
  } catch {
    return "0";
  }
}

function eth(x: string | bigint | number | null | undefined) {
  return Number(formatEther(safeBigInt(x))).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function csd(x: string | bigint | number | null | undefined) {
  return Number(formatUnits(safeBigInt(x), 8)).toLocaleString(undefined, {
    maximumFractionDigits: 8,
  });
}

function usdPrice(x: string | bigint | number | null | undefined) {
  return Number(formatUnits(safeBigInt(x), 6)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function usdc(x: string | bigint | number | null | undefined) {
  return Number(formatUnits(safeBigInt(x), 6)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function formatWindow(ms?: number) {
  if (!ms || ms <= 0) return "0m 0s";
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function toWeiInput(x: string) {
  try {
    const [whole, frac = ""] = x.trim().split(".");
    const padded = (frac + "0".repeat(18)).slice(0, 18);
    return BigInt(whole || "0") * 10n ** 18n + BigInt(padded || "0");
  } catch {
    return 0n;
  }
}

function requiredForOrder(side: string, amount: string, price: string) {
  const amountWei = toWeiInput(amount);
  const priceWei = toWeiInput(price);
  if (side === "0") {
    return { token: "WETH", required: amountWei };
  }
  return {
    token: "USDC",
    required: (amountWei * priceWei) / 10n ** 18n,
  };
}

function secondsLeft(validBefore: string | number | bigint) {
  return Math.max(0, Number(validBefore) - Math.floor(Date.now() / 1000));
}

function toUsdcInput(x: string) {
  try {
    const [whole, frac = ""] = x.trim().split(".");
    const padded = (frac + "0".repeat(6)).slice(0, 6);
    return BigInt(whole || "0") * 10n ** 6n + BigInt(padded || "0");
  } catch {
    return 0n;
  }
}

function txUrl(tx?: string) {
  if (!tx) return null;
  const base = process.env.NEXT_PUBLIC_EXPLORER_TX_BASE;
  return base ? `${base}${tx}` : null;
}

function csdTxUrl(tx?: string) {
  if (!tx) return null;
  const base = process.env.NEXT_PUBLIC_CSD_EXPLORER_TX_BASE;
  return base ? `${base}${tx}` : null;
}

function explorerLink(tx?: string, label = "View tx") {
  const url = txUrl(tx);
  if (!tx || !url) return short(tx);
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
      {label}: {short(tx)}
    </a>
  );
}

function csdExplorerLink(tx?: string, label = "View CSD tx") {
  const url = csdTxUrl(tx);
  if (!tx || !url) return short(tx);
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
      {label}: {short(tx)}
    </a>
  );
}

function readableCsdProofError(msg: string) {
  if (msg.includes("CSD_TX_NOT_FOUND") || msg.includes("TX_NOT_FOUND")) {
    return "CSD transaction not found yet. Wait until the transaction is broadcast/indexed, then try again.";
  }
  if (
    msg.includes("CSD_CONFIRMATIONS_TOO_LOW") ||
    msg.includes("CONFIRMATIONS_TOO_LOW")
  ) {
    return "CSD payment found, but it does not have enough confirmations yet. Wait for the next block, then try again.";
  }
  if (msg.includes("INVALID_CSD_PROOF") || msg.includes("CSD_PROOF_REJECTED")) {
    return "CSD proof is not valid for this trade. Check that the txid pays the exact amount to the one-time wallet address.";
  }
  if (msg.includes("AuthorizationRevoked")) {
    return "Buyer authorization was revoked before settlement lock.";
  }
  if (msg.includes("AuthorizationExpired")) {
    return "Buyer authorization expired. Create a new buy authorization.";
  }
  return msg;
}

function readableError(error?: string) {
  if (!error) return null;
  if (error.includes("AuthExposureExceeded")) return "Authorization boundary exceeded.";
  if (error.includes("AuthorizationRevoked")) return "Authorization was revoked.";
  if (error.includes("AuthorizationExpired")) return "Authorization expired.";
  if (error.includes("OrderCancelled")) return "Order was cancelled.";
  if (error.includes("OrderAmountExceeded")) return "Order amount exceeded.";
  if (error.includes("InvalidPrice")) return "Price outside authorization band.";
  if (error.includes("BALANCE")) return "Insufficient token balance.";
  if (error.includes("TransferFailed")) return "Token transfer failed.";
  if (error.includes("0xed53879a")) return "Authorization exposure exceeded.";
  if (error.includes("0x00bfc921"))
    return "Invalid price: order price is outside the required match or authorization boundary.";
  if (error.includes("CsdTxAlreadyConsumed")) {
    return "This CSD transaction proof has already been consumed.";
  }
  if (error.includes("CSD_CONFIRMATIONS_TOO_LOW")) {
    return "CSD payment found, but the proof does not have enough confirmations yet. Refresh the proof after the next block.";
  }
  return "Execution rejected.";
}

function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function isValidAddr20(x: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(x.trim());
}

function authUsage(authHash: string, fills: any[], orders: any[]) {
  let usedBase = 0n;
  let usedQuote = 0n;
  const orderByHash = new Map(orders.map((o) => [o.orderHash.toLowerCase(), o]));
  for (const f of fills) {
    if (f.status !== "settled") continue;
    const maker = orderByHash.get(f.makerOrderHash?.toLowerCase());
    const taker = orderByHash.get(f.takerOrderHash?.toLowerCase());
    if (f.makerAuthHash?.toLowerCase() === authHash.toLowerCase() && maker) {
      if (maker.order.side === 0) usedBase += BigInt(f.baseAmount);
      if (maker.order.side === 1) usedQuote += BigInt(f.quoteAmount);
    }
    if (f.takerAuthHash?.toLowerCase() === authHash.toLowerCase() && taker) {
      if (taker.order.side === 0) usedBase += BigInt(f.baseAmount);
      if (taker.order.side === 1) usedQuote += BigInt(f.quoteAmount);
    }
  }
  return { usedBase, usedQuote };
}

function statusStyle(status: string) {
  if (status === "filled" || status === "settled") return "#9ff5c8";
  if (status === "partially_filled") return "#ffe19f";
  if (status === "dead" || status === "rejected") return "#ff9fb0";
  return "#a8acb5";
}

function tradePriceNumber(t: any) {
  return Number(formatUnits(safeBigInt(t.price), 6));
}

function tradeTime(t: any) {
  return Number(t.settledAt ?? 0);
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [sellerCsdScriptPubKey, setSellerCsdScriptPubKey] = useState<string>("");
  const [sellerUsdcRecipient, setSellerUsdcRecipient] = useState<string>("");
  const [csdAmount, setCsdAmount] = useState("500000000");
  const [csdUsdcAmount, setCsdUsdcAmount] = useState("5");
  const [csdProofJson, setCsdProofJson] = useState("");
  const [isCsdSettling, setIsCsdSettling] = useState(false);
  const [csdSettlementTx, setCsdSettlementTx] = useState<Hex | null>(null);
  const [csdPricePerCoin, setCsdPricePerCoin] = useState("1");
  const [isLockingCsdIntent, setIsLockingCsdIntent] = useState(false);
  const [csdLockTx, setCsdLockTx] = useState<Hex | null>(null);
  const [csdAuthStatus, setCsdAuthStatus] = useState<"none" | "active" | "revoked" | "locked" | "settled">("none");
  const [nowMs, setNowMs] = useState(Date.now());
  const [csdLockExpiresAt, setCsdLockExpiresAt] = useState<number | null>(null);
  const [csdMode, setCsdMode] = useState<"buy" | "sell">("buy");
  const [selectedSellIntent, setSelectedSellIntent] = useState<any | null>(null);
  const [sellerCsdTxid, setSellerCsdTxid] = useState("");
  const [csdAmountHuman, setCsdAmountHuman] = useState("5");
  const [lockedUsdc, setLockedUsdc] = useState("0");

  function toCsdBaseUnits(x: string) {
    const [whole, frac = ""] = x.trim().split(".");
    return (
      BigInt(whole || "0") * 100000000n +
      BigInt((frac + "00000000").slice(0, 8) || "0")
    ).toString();
  }

  const [csdIntentHash, setCsdIntentHash] = useState<Hex | null>(null);
  const [csdAuthorization, setCsdAuthorization] = useState<any | null>(null);
  const [csdAuthorizationSignature, setCsdAuthorizationSignature] = useState<Hex | null>(null);

  function resetCsdFlow() {
    setCsdIntentHash(null);
    setCsdAuthorization(null);
    setCsdAuthorizationSignature(null);
    setCsdLockTx(null);
    setCsdSettlementTx(null);
    setCsdLockExpiresAt(null);
    setCsdAuthStatus("none");
  }

  const [isCreatingCsdIntent, setIsCreatingCsdIntent] = useState(false);
  const [sellIntentHash, setSellIntentHash] = useState<Hex | null>(null);
  const [activeMarket, setActiveMarket] = useState<"ETH-USDC" | "CSD-USDC">("CSD-USDC");
  const [csdGenesisHash, setCsdGenesisHash] = useState<Hex>(
    "0x00000052c2821f71b19c3d79dfabfb12d4076ba15d83b47d008e582aad6c0d52"
  );
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [executor, setExecutor] = useState<Address>(
    "0x78967F9d1993482122efe6628C3FEdCb6F4938dD"
  );
  const [auths, setAuths] = useState<any[]>([]);

  const connectedWalletAuth =
    address
      ? auths
          .filter((a) => a.status === "active")
          .filter((a) => a.auth.grantor.toLowerCase() === address.toLowerCase())
          .at(-1)
      : null;

  const [balances, setBalances] = useState<{ weth: string; usdc: string; csd: string }>({
    weth: "0",
    usdc: "0",
    csd: "0",
  });
  const [allowances, setAllowances] = useState<{
    weth: string;
    usdc: string;
    csdUsdc: string;
  }>({
    weth: "0",
    usdc: "0",
    csdUsdc: "0",
  });
  const [logs, setLogs] = useState<Log[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [fills, setFills] = useState<any[]>([]);
  const [book, setBook] = useState<any>({ bids: [], asks: [] });
  const [csdBook, setCsdBook] = useState<any>({ bids: [], asks: [] });
  const [csdTrades, setCsdTrades] = useState<any[]>([]);
  const [csdIntents, setCsdIntents] = useState<any[]>([]);
  const [lastRevokedAuth, setLastRevokedAuth] = useState<Hex | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isApproving, setIsApproving] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [cancellingOrderHash, setCancellingOrderHash] = useState<Hex | null>(null);
  const [maxEth, setMaxEth] = useState("5");
  const [maxUsdc, setMaxUsdc] = useState("15000");
  const [minPrice, setMinPrice] = useState("2500");
  const [maxPrice, setMaxPrice] = useState("3500");
  const [duration, setDuration] = useState("3600");
  const [side, setSide] = useState("0");
  const [price, setPrice] = useState("3000");
  const [amount, setAmount] = useState("1");

  const addLog = (text: string) =>
    setLogs((l) => [{ ts: Date.now(), text }, ...l].slice(0, 30));

  const orderRequirement = requiredForOrder(side, amount, price);
  const availableForOrder =
    orderRequirement.token === "WETH" ? BigInt(balances.weth) : BigInt(balances.usdc);
  const hasEnoughBalance = availableForOrder >= orderRequirement.required;
  const availableAllowance =
    orderRequirement.token === "WETH" ? BigInt(allowances.weth) : BigInt(allowances.usdc);
  const hasEnoughAllowance = availableAllowance >= orderRequirement.required;
  const displayedAuth = connectedWalletAuth;
  const usage = displayedAuth ? authUsage(displayedAuth.authHash, fills, orders) : null;
  const remainingBase =
    displayedAuth && usage
      ? BigInt(displayedAuth.auth.maxBaseExposure) - usage.usedBase
      : 0n;
  const remainingQuote =
    displayedAuth && usage
      ? BigInt(displayedAuth.auth.maxQuoteExposure) - usage.usedQuote
      : 0n;

  const myActiveCsdSellIntents =
    address
      ? (csdBook.asks || []).filter(
          (i: any) => i.seller?.toLowerCase() === address.toLowerCase()
        )
      : [];

const myCsdSellIntent =
  address
    ? (csdIntents || [])
        .filter((i: any) => {
          const me = address.toLowerCase();

          return (
            i.seller?.toLowerCase() === me ||
            i.authorization?.sellerUsdcRecipient?.toLowerCase() === me
          );
        })
        .filter((i: any) =>
          i.status === "pending_csd_payment" ||
          i.status === "locked_for_settlement"
        )
        .at(-1)
    : null;

const myLockedCsdSellIntent =
  myCsdSellIntent?.status === "locked_for_settlement"
    ? myCsdSellIntent
    : null;

  const myActiveCsdBuyIntent =
    address
      ? (csdIntents || [])
          .filter(
            (i: any) => i.authorization?.buyer?.toLowerCase() === address.toLowerCase()
          )
          .filter(
            (i: any) =>
              i.status === "pending_csd_payment" || i.status === "locked_for_settlement"
          )
          .at(-1)
      : null;

const myExpiredCsdIntent =
  address
    ? (csdIntents || [])
        .filter(
          (i:any) =>
            i.authorization?.buyer?.toLowerCase() ===
            address.toLowerCase()
        )
        .find(
          (i:any) =>
            i.status === "expired_lock"
        )
    : null;

  const csdSettlementWindowRemainingMs =
    csdLockExpiresAt && !csdSettlementTx
      ? Math.max(0, csdLockExpiresAt - nowMs)
      : 0;

const sellerIntentLocked =
  myCsdSellIntent?.status === "locked_for_settlement";

const sellerIntentHash =
  myCsdSellIntent?.intentHash as Hex | undefined;

  const visibleCsdIntentHash = myActiveCsdBuyIntent?.intentHash as Hex | undefined;
  const visibleCsdAuthStatus =
    myActiveCsdBuyIntent?.status === "locked_for_settlement"
      ? csdSettlementWindowRemainingMs > 0
        ? "locked"
        : "active"
      : myActiveCsdBuyIntent?.status === "pending_csd_payment"
      ? "active"
      : csdAuthStatus;

  const hasEnoughAuthCapacity =
    !displayedAuth
      ? false
      : orderRequirement.token === "WETH"
      ? remainingBase >= orderRequirement.required
      : remainingQuote >= orderRequirement.required;

  const canPlaceOrder =
    !!displayedAuth && hasEnoughBalance && hasEnoughAllowance && hasEnoughAuthCapacity;

  const balanceReads = useReadContracts({
    contracts:
      cfg && address
        ? [
            {
              address: cfg.weth,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            },
            {
              address: cfg.usdc,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            },
            {
              address: cfg.weth,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, cfg.settlement],
            },
            {
              address: cfg.usdc,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, cfg.settlement],
            },
            {
              address: cfg.usdc,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, cfg.csdUsdcSettlement],
            },
          ]
        : [],
    query: {
      enabled: !!cfg && !!address,
      refetchInterval: 1500,
    },
  });

  useEffect(() => {
    const weth = balanceReads.data?.[0]?.result;
    const usdc = balanceReads.data?.[1]?.result;
    const wethAllowance = balanceReads.data?.[2]?.result;
    const usdcAllowance = balanceReads.data?.[3]?.result;
    const csdUsdcAllowance = balanceReads.data?.[4]?.result;
    if (weth !== undefined && usdc !== undefined) {
      setBalances((prev) => ({
        ...prev,
        weth: weth.toString(),
        usdc: usdc.toString(),
        csd: prev.csd ?? "0",
      }));
    }
    if (
      wethAllowance !== undefined &&
      usdcAllowance !== undefined &&
      csdUsdcAllowance !== undefined
    ) {
      setAllowances({
        weth: wethAllowance.toString(),
        usdc: usdcAllowance.toString(),
        csdUsdc: csdUsdcAllowance.toString(),
      });
    }
  }, [balanceReads.data]);

  async function refresh() {
    const [
      ordersRes,
      bookRes,
      fillsRes,
      authsRes,
      csdBookRes,
      csdTradesRes,
      csdIntentsRes,
    ] = await Promise.all([
      fetch(`${BACKEND}/v1/orders`).then((r) => r.json()).catch(() => ({ orders: [] })),
      fetch(`${BACKEND}/v1/book`).then((r) => r.json()).catch(() => ({ bids: [], asks: [] })),
      fetch(`${BACKEND}/v1/fills`).then((r) => r.json()).catch(() => ({ fills: [] })),
      fetch(`${BACKEND}/v1/session-authorizations`)
        .then((r) => r.json())
        .catch(() => ({ authorizations: [] })),
      fetch(`${BACKEND}/v1/csd-book`)
        .then((r) => r.json())
        .catch(() => ({ bids: [], asks: [] })),
      fetch(`${BACKEND}/v1/markets/CSD-USDC/trades`)
        .then((r) => r.json())
        .catch(() => ({ trades: [] })),
      fetch(`${BACKEND}/v1/csd-usdc/intents`)
        .then((r) => r.json())
        .catch(() => ({ intents: [] })),
    ]);

    if (isValidAddr20(sellerCsdScriptPubKey)) {
      const csdUtxosRes = await fetch(
`${BACKEND}/v1/csd/utxos/${sellerCsdScriptPubKey}`
      )
        .then((r) => r.json())
        .catch(() => null);
      if (csdUtxosRes?.ok) {
        setBalances((prev) => ({
          ...prev,
csd: safeBaseUnits8(csdUtxosRes.confirmed_balance),
        }));
      }
    }

    setAuths(authsRes.authorizations || []);
    setOrders(ordersRes.orders || []);
    setBook(bookRes);
    setFills(fillsRes.fills || []);
    setCsdBook(csdBookRes);
    setCsdTrades(csdTradesRes.trades || []);
    setCsdIntents(csdIntentsRes.intents || []);


const visibleIntent = [...(csdIntentsRes.intents || [])]
  .filter((i: any) => {
  if (!address) return false;

  const me = address.toLowerCase();

  const isBuyer =
    i.authorization?.buyer?.toLowerCase() === me;

  const isSeller =
    i.seller?.toLowerCase() === me;

  const isSellerRecipient =
    i.authorization?.sellerUsdcRecipient?.toLowerCase() === me;

  return (
    (isBuyer || isSeller || isSellerRecipient) &&
    i.status === "locked_for_settlement"
  );
})
.sort((a: any, b: any) => Number(b.lockedAt ?? 0) - Number(a.lockedAt ?? 0))[0];


if (visibleIntent?.intentHash) {
  const lockRes = await fetch(
    `${BACKEND}/v1/csd-usdc/lock/${visibleIntent.intentHash}`
  )
    .then((r) => r.json())
    .catch(() => null);

  setLockedUsdc(lockRes?.lockedBalance ?? "0");

  if (visibleIntent.status === "locked_for_settlement") {
    setCsdLockTx(visibleIntent.lockTxHash ?? null);
    setCsdLockExpiresAt(visibleIntent.lockExpiresAt ?? null);
    setCsdIntentHash(visibleIntent.intentHash);
  }
} else {
  setLockedUsdc("0");
}
}
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!myActiveCsdBuyIntent) {
      resetCsdFlow();
      return;
    }
    setCsdIntentHash(myActiveCsdBuyIntent.intentHash);
    setCsdAuthorization(myActiveCsdBuyIntent.authorization);
    setCsdAuthorizationSignature(myActiveCsdBuyIntent.authorizationSignature);
    if (myActiveCsdBuyIntent.status === "locked_for_settlement") {
      setCsdAuthStatus("locked");
      setCsdLockTx(myActiveCsdBuyIntent.lockTxHash ?? null);
      setCsdLockExpiresAt(myActiveCsdBuyIntent.lockExpiresAt ?? null);
    } else {
      setCsdAuthStatus("active");
    }
  }, [address, myActiveCsdBuyIntent?.intentHash, myActiveCsdBuyIntent?.status]);

useEffect(() => {
  fetchConfig().then(setCfg).catch((e) => addLog(`config error: ${e.message}`));
}, []);

useEffect(() => {
  if (!address) return;

  refresh();

  const id = setInterval(() => {
    refresh();
  }, 1500);

  return () => clearInterval(id);
}, [address, sellerCsdScriptPubKey]);

  useEffect(() => {
    if (address && !sellerUsdcRecipient) {
      setSellerUsdcRecipient(address);
    }
  }, [address, sellerUsdcRecipient]);

useEffect(() => {
  if (!address) return;

  const ws = new WebSocket(`${BACKEND.replace("http", "ws")}/v1/ws`);

  ws.onmessage = (ev) => {
    addLog(ev.data);
    refresh();
  };

  return () => ws.close();
}, [address, sellerCsdScriptPubKey]);

  if (!mounted) return null;

async function refundExpiredLock() {
  if (!myExpiredCsdIntent) return;

  try {
    addLog("Refunding expired settlement lock...");

    const res = await postJson("/v1/csd-usdc/refund", {
      intentHash: myExpiredCsdIntent.intentHash,
    });

    setLockedUsdc("0");
    await refresh();

    setStatusMessage("Expired settlement lock refunded.");
    addLog(`Refund tx submitted: ${res.txHash}`);
  } catch (err: any) {
    const msg = err?.message ?? JSON.stringify(err);
    setStatusMessage(`Refund failed: ${msg}`);
    addLog(`Refund failed: ${msg}`);
  }
}

  async function approveTokens() {
    if (!cfg) return;
    try {
      setIsApproving(true);
      addLog("Approving WETH + USDC to settlement contract...");
      await writeContractAsync({
        address: cfg.weth,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.settlement, maxUint256],
      });
      await writeContractAsync({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.csdUsdcSettlement, maxUint256],
      });
      addLog("Approvals submitted.");
      balanceReads.refetch?.();
    } finally {
      setIsApproving(false);
    }
  }

  async function enableTrading() {
    if (!cfg || !address) return;
    try {
      setIsAuthorizing(true);
      const auth = buildAuth({
        account: address,
        cfg,
        executor,
        sideMask: 3,
        maxEth,
        maxUsdc,
        minPrice,
        maxPrice,
        durationSeconds: Number(duration),
      });
      addLog("Signing trading authorization...");
      const signature = await signTypedDataAsync({
        domain: domain(cfg.chainId, cfg.settlement),
        types: AUTH_TYPES,
        primaryType: "TradingSessionAuthorization",
        message: {
          ...auth,
          maxBaseExposure: BigInt(auth.maxBaseExposure),
          maxQuoteExposure: BigInt(auth.maxQuoteExposure),
          minPrice: BigInt(auth.minPrice),
          maxPrice: BigInt(auth.maxPrice),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
        },
      });
      const res = await postJson("/v1/session-authorizations", {
        authorization: auth,
        signature,
      });
      setLastRevokedAuth(null);
      setStatusMessage(
        "Authorization active. Orders can now execute within the defined boundary."
      );
      addLog(`Authorization active: ${res.authHash}`);
    } finally {
      setIsAuthorizing(false);
    }
  }

  async function approveCsdUsdc() {
    if (!cfg) return;
    try {
      setIsApproving(true);
      addLog("Approving USDC to CSD/USDC settlement contract...");
      const tx = await writeContractAsync({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.csdUsdcSettlement, maxUint256],
      });
      addLog(`USDC approval submitted: ${tx}`);
      addLog(
        "Approval transaction submitted. Wait for it to be included in a block, then click Buy CSD again."
      );
      setAllowances((prev) => ({
        ...prev,
        csdUsdc: maxUint256.toString(),
      }));
      balanceReads.refetch?.();
      await refresh();
    } finally {
      setIsApproving(false);
    }
  }

  async function buyCsd() {
    if (!cfg || !address) return;
    const intent = selectedSellIntent ?? csdBook.asks?.[0];
    if (!intent) {
      setStatusMessage("No CSD sell offer selected.");
      return;
    }
    setSellIntentHash(intent.intentHash);
    setSellerUsdcRecipient(intent.sellerUsdcRecipient ?? sellerUsdcRecipient);
    setCsdAmount(intent.csdAmount.toString());
    setCsdUsdcAmount(usdc(intent.usdcAmount));
    try {
      if (BigInt(allowances.csdUsdc) < BigInt(intent.usdcAmount)) {
        await approveCsdUsdc();
        return;
      }
      if (!csdIntentHash) {
        await createCsdUsdcIntent();
        return;
      }
setStatusMessage("Buyer authorization created. Waiting for seller to lock settlement.");
return;
      setStatusMessage("Settlement locked. Waiting for seller to send CSD.");
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err);
      setStatusMessage(`Buy CSD failed: ${msg}`);
      addLog(`Buy CSD failed: ${msg}`);
    }
  }

  async function placeOrder() {
    const usableAuth = connectedWalletAuth;
    if (!usableAuth) {
      setStatusMessage("No active authorization. Enable trading before placing orders.");
      return;
    }
    if (!hasEnoughBalance) {
      setStatusMessage(
        `Insufficient ${orderRequirement.token}. Required ${eth(orderRequirement.required)}, available ${eth(availableForOrder)}.`
      );
      return;
    }
    if (!hasEnoughAllowance) {
      setStatusMessage(
        `Insufficient ${orderRequirement.token} approval. Required ${eth(orderRequirement.required)}, approved ${eth(availableAllowance)}.`
      );
      return;
    }
    if (!hasEnoughAuthCapacity) {
      setStatusMessage("Order exceeds remaining authorization boundary.");
      return;
    }
    if (!cfg || !address) return;
    try {
      setIsPlacingOrder(true);
      const order = buildOrder({
        account: address,
        side: Number(side),
        price,
        amount,
        sessionAuthHash: usableAuth.authHash,
        durationSeconds: 3600,
      });
      addLog("Signing order...");
      const signature = await signTypedDataAsync({
        domain: domain(cfg.chainId, cfg.settlement),
        types: ORDER_TYPES,
        primaryType: "SignedOrder",
        message: {
          ...order,
          price: BigInt(order.price),
          baseAmount: BigInt(order.baseAmount),
          validAfter: BigInt(order.validAfter),
          validBefore: BigInt(order.validBefore),
        },
      });
      const res = await postJson("/v1/orders", { order, signature });
      addLog(`Order open: ${res.orderHash}`);
      balanceReads.refetch?.();
      await refresh();
    } finally {
      setIsPlacingOrder(false);
    }
  }

  async function revoke() {
    const usableAuth = connectedWalletAuth;
    if (!cfg || !usableAuth) return;
    try {
      setIsRevoking(true);
      addLog("Revoking authorization onchain...");
      const tx = await writeContractAsync({
        address: cfg.registry,
        abi: registryAbi,
        functionName: "revokeAuthorization",
        args: [usableAuth.authHash],
      });
      addLog(`Revoke tx submitted: ${tx}`);
      setAuths((prev) =>
        prev.map((a) =>
          a.authHash.toLowerCase() === usableAuth.authHash.toLowerCase()
            ? { ...a, status: "revoked" }
            : a
        )
      );
      setOrders((prev) =>
        prev.map((o) =>
          o.order.sessionAuthHash.toLowerCase() === usableAuth.authHash.toLowerCase() &&
          (o.status === "open" || o.status === "partially_filled")
            ? { ...o, status: "dead" }
            : o
        )
      );
      await postJson(`/v1/session-authorizations/${usableAuth.authHash}/revoked`, {});
      setLastRevokedAuth(usableAuth.authHash);
      setStatusMessage(
        "Authorization revoked. Execution stopped. Create a new authorization to trade again."
      );
      balanceReads.refetch?.();
      await refresh();
    } finally {
      setIsRevoking(false);
    }
  }

  async function cancelCsdSellIntentByHash(intentHash: Hex) {
    if (!address) return;
    try {
      const res = await postJson(`/v1/csd-sell-intents/${intentHash}/cancel`, {
        seller: address,
      });
      setStatusMessage("CSD sell offer cancelled.");
      addLog(`CSD sell intent cancelled: ${res.intentHash}`);
      if (sellIntentHash?.toLowerCase() === intentHash.toLowerCase()) {
        setSellIntentHash(null);
      }
      await refresh();
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err);
      if (msg.includes("SELL_INTENT_LOCKED_FOR_SETTLEMENT")) {
        setStatusMessage(
          "This sell offer is locked for settlement. It cannot be cancelled during the bounded proof window."
        );
        addLog("Cancel rejected: sell intent locked for settlement.");
      } else {
        setStatusMessage(`Cancel failed: ${msg}`);
        addLog(`Cancel failed: ${msg}`);
      }
      await refresh();
    }
  }

  async function cancelOrder(orderHash: Hex) {
    if (!cfg) return;
    try {
      setCancellingOrderHash(orderHash);
      addLog(`Cancelling order: ${orderHash}`);
      const tx = await writeContractAsync({
        address: cfg.registry,
        abi: registryAbi,
        functionName: "cancelOrder",
        args: [orderHash],
      });
      addLog(`Cancel tx submitted: ${tx}`);
      setOrders((prev) =>
        prev.map((o) =>
          o.orderHash.toLowerCase() === orderHash.toLowerCase()
            ? { ...o, status: "cancelled" }
            : o
        )
      );
      await postJson(`/v1/orders/${orderHash}/cancelled`, {});
      await refresh();
    } finally {
      setCancellingOrderHash(null);
    }
  }

  async function createCsdUsdcIntent() {
    if (!cfg || !address) return;
    if (!isValidAddr20(sellerCsdScriptPubKey)) {
      setStatusMessage(
        "Enter a valid one-time CSD wallet address: addr20 / 20-byte hex, e.g. 0x..."
      );
      addLog("Invalid one-time CSD wallet address.");
      return;
    }
    if (!sellIntentHash) {
      setStatusMessage("Create a CSD sell intent first.");
      addLog("Missing CSD sell intent.");
      return;
    }
    try {
      setIsCreatingCsdIntent(true);
      setCsdIntentHash(null);
      setCsdSettlementTx(null);
      const nowTs = Math.floor(Date.now() / 1000);
      const auth = {
        buyer: address as Address,
        sellerUsdcRecipient: sellerUsdcRecipient as Address,
        sellerCsdScriptHash: keccak256(sellerCsdScriptPubKey as Hex),
        csdGenesisHash,
        tradeIntentHash: sellIntentHash,
        csdAmount: BigInt(csdAmount),
        usdc: cfg.usdc,
        usdcAmount: toUsdcInput(csdUsdcAmount),
        minConfirmations: 1n,
        validAfter: BigInt(nowTs - 60),
        validBefore: BigInt(nowTs + 3600),
        nonce: randomNonce(),
      };
      addLog("Signing CSD/USDC buyer authorization...");
      const signature = await signTypedDataAsync({
        domain: {
          name: "Covenant CSD/USDC",
          version: "1",
          chainId: cfg.chainId,
          verifyingContract: cfg.csdUsdcSettlement,
        },
        types: CSD_USDC_TYPES,
        primaryType: "CsdUsdcAuthorization",
        message: auth,
      });
      const res = await postJson("/v1/csd-usdc/intent", {
        authorization: {
          ...auth,
          csdAmount: auth.csdAmount.toString(),
          usdcAmount: auth.usdcAmount.toString(),
          minConfirmations: auth.minConfirmations.toString(),
          validAfter: Number(auth.validAfter),
          validBefore: Number(auth.validBefore),
        },
        authorizationSignature: signature,
        expectedRecipientScriptPubKey: sellerCsdScriptPubKey,
      });
      setCsdIntentHash(res.intentHash);
      setCsdAuthStatus("active");
      setLastRevokedAuth(null);
 
setCsdAuthorization({
  ...auth,
  csdAmount: auth.csdAmount.toString(),
  usdcAmount: auth.usdcAmount.toString(),
  minConfirmations: auth.minConfirmations.toString(),
  validAfter: auth.validAfter.toString(),
  validBefore: auth.validBefore.toString(),
});

      setCsdAuthorizationSignature(signature);
      addLog(`CSD/USDC intent created: ${res.intentHash}`);
      setStatusMessage(
        "Buyer authorization created. Seller can now send CSD and submit proof."
      );
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err);
      setStatusMessage(`CSD/USDC intent failed: ${msg}`);
      addLog(`CSD/USDC intent failed: ${msg}`);
    } finally {
      setIsCreatingCsdIntent(false);
    }
  }

  async function createCsdSellIntent() {
    if (!address) return;
    const amountBase = toCsdBaseUnits(csdAmountHuman);
    const usdcTotal = toUsdcInput(
      (Number(csdAmountHuman) * Number(csdPricePerCoin)).toString()
    ).toString();

if (BigInt(usdcTotal) > 50n * 1_000_000n) {
  setStatusMessage("CSD/USDC trades are currently capped at 50 USDC.");
  addLog("Trade rejected locally: 50 USDC cap.");
  return;
}

    const res = await postJson("/v1/csd-sell-intents", {
      seller: address,
      sellerUsdcRecipient: sellerUsdcRecipient as Address,
      csdGenesisHash,
      csdAmount: amountBase,
      usdcAmount: usdcTotal,
    });
    setSellIntentHash(res.intent.intentHash);
    addLog(`CSD sell intent created: ${res.intent.intentHash}`);
    setStatusMessage(
      "CSD sell intent created. Buyer now chooses a one-time CSD wallet address for settlement."
    );
  }

async function lockCsdUsdcIntent() {
  const targetHash = csdMode === "sell" ? sellerIntentHash : csdIntentHash;
  if (!targetHash || !address) return;

  try {
    setIsLockingCsdIntent(true);
    addLog("Locking CSD/USDC authorization for settlement...");

    const res = await postJson("/v1/csd-usdc/lock", {
      intentHash: targetHash,
      seller: address,
    });

    setCsdLockTx(res.txHash);
    setCsdLockExpiresAt(res.lockExpiresAt ?? Date.now() + 10 * 60 * 1000);
    setCsdAuthStatus("locked");

if (res.lockedBalance) {
  setLockedUsdc(res.lockedBalance.toString());
}

    await refresh();

    addLog(`CSD/USDC settlement lock active: ${res.txHash}`);
    setStatusMessage("Settlement lock active. USDC is reserved onchain.");
  } catch (err: any) {
    const msg = err?.message ?? JSON.stringify(err);
    setStatusMessage(`CSD/USDC lock failed: ${msg}`);
    addLog(`CSD/USDC lock failed: ${msg}`);
  } finally {
    setIsLockingCsdIntent(false);
  }
}

  async function revokeCsdUsdcAuthorization() {
    const targetIntentHash = visibleCsdIntentHash ?? csdIntentHash;
    if (!cfg || !targetIntentHash) return;
    try {
      setIsRevoking(true);
      addLog("Revoking CSD/USDC buyer authorization...");
      const tx = await writeContractAsync({
        address: cfg.registry,
        abi: registryAbi,
        functionName: "revokeAuthorization",
        args: [targetIntentHash],
      });
      resetCsdFlow();
      setCsdAuthStatus("revoked");
      setStatusMessage("CSD/USDC buyer authorization revoked. This buy is cancelled.");
      setLastRevokedAuth(targetIntentHash);
      await refresh();
      addLog(`CSD/USDC revoke tx submitted: ${tx}`);
    } finally {
      setIsRevoking(false);
    }
  }

  async function settleCsdUsdcIntent() {
    if (!csdIntentHash || !csdProofJson) return;
    try {
      setIsCsdSettling(true);
      const proof = JSON.parse(csdProofJson);
      addLog("Submitting CSD proof for existing intent...");
      const res = await postJson("/v1/csd-usdc/settle", {
        intentHash: csdIntentHash,
        csdProof: proof,
      });
      setCsdSettlementTx(res.txHash);
      setCsdAuthStatus("settled");
      addLog(`CSD/USDC settled: ${res.txHash}`);
      setStatusMessage("CSD proof matched the authorization. USDC settled.");
      balanceReads.refetch?.();
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err);
      setStatusMessage(`CSD/USDC settlement failed: ${msg}`);
      addLog(`CSD/USDC settlement failed: ${msg}`);
    } finally {
      setIsCsdSettling(false);
    }
  }

  async function settleCsdUsdcByTxid() {
const targetHash =
  csdMode === "sell"
    ? myCsdSellIntent?.intentHash
    : csdIntentHash;

if (!targetHash || !sellerCsdTxid) return;
    try {
      setIsCsdSettling(true);
      addLog("Fetching CSD proof and settling...");
      const res = await postJson("/v1/csd-usdc/settle-by-txid", {
intentHash: targetHash,
        csdTxid: sellerCsdTxid,
      });
      setCsdSettlementTx(res.txHash);
      setCsdAuthStatus("settled");
      addLog(`CSD/USDC settled: ${res.txHash}`);
      setStatusMessage("CSD payment verified. USDC settled.");
      balanceReads.refetch?.();
      await refresh();
    } catch (err: any) {
      const raw = err?.message ?? JSON.stringify(err);
      const msg = readableCsdProofError(raw);
      setStatusMessage(msg);
      addLog(`CSD/USDC settlement failed: ${msg}`);
    } finally {
      setIsCsdSettling(false);
    }
  }

  function loadScenario(kind: "sell5" | "buy5" | "smallSell") {
    if (kind === "sell5") {
      setSide("0");
      setAmount("5");
      setPrice("3000");
      setMaxEth("5");
      setMaxUsdc("15000");
      setMinPrice("2500");
      setMaxPrice("3500");
      setDuration("3600");
      setStatusMessage("Scenario loaded: authorize and place a 5 ETH sell order.");
    }
    if (kind === "buy5") {
      setSide("1");
      setAmount("5");
      setPrice("3000");
      setMaxEth("5");
      setMaxUsdc("15000");
      setMinPrice("2500");
      setMaxPrice("3500");
      setDuration("3600");
      setStatusMessage("Scenario loaded: authorize and place a 5 ETH buy order.");
    }
    if (kind === "smallSell") {
      setSide("0");
      setAmount("1");
      setPrice("3000");
      setMaxEth("1");
      setMaxUsdc("3000");
      setMinPrice("2500");
      setMaxPrice("3500");
      setDuration("3600");
      setStatusMessage("Scenario loaded: small 1 ETH sell order.");
    }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ marginBottom: 56 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div>
            <div
              className="faint"
              style={{
                fontSize: 12,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Covenant v0
            </div>
            <h1
              style={{
                margin: "12px 0 0",
                fontSize: 56,
                lineHeight: 1.05,
                maxWidth: 720,
              }}
            >
              Execution no longer requires trust.
            </h1>
            <p
              className="muted"
              style={{
                marginTop: 14,
                maxWidth: 680,
                fontSize: 18,
              }}
            >
              Settlement requires current authorization.
            </p>
          </div>
          <div style={{ display: "grid", gap: 14, justifyItems: "end" }}>
            <nav className="row" style={{ gap: 14 }}>
              <Link className="muted" href="/">Market</Link>
              <Link className="muted" href="/about">About</Link>
              <Link className="muted" href="/docs">Docs</Link>
            </nav>
            <div className="row">
              {isConnected ? (
                <>
                  <span className="muted">{short(address)}</span>
                  <button className="btn secondary" onClick={() => disconnect()}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => connect({ connector: injected() })}>
                  Connect wallet
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {statusMessage && (
        <section
          className="card"
          style={{
            marginBottom: 18,
            borderColor: lastRevokedAuth
              ? "rgba(255,120,140,0.35)"
              : "rgba(255,255,255,0.10)",
          }}
        >
          <div className="faint">System state</div>
          <div style={{ marginTop: 8, fontSize: 22 }}>{statusMessage}</div>
          {lastRevokedAuth && (
            <div className="muted" style={{ marginTop: 10, wordBreak: "break-all", fontSize: 13 }}>
              Revoked authorization: {lastRevokedAuth}
            </div>
          )}
        </section>
      )}

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="faint">Market</div>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <button
            className={activeMarket === "CSD-USDC" ? "btn" : "btn secondary"}
            onClick={() => setActiveMarket("CSD-USDC")}
          >
            CSD / USDC
          </button>
          {/*
          <button
            className={activeMarket === "ETH-USDC" ? "btn" : "btn secondary"}
            onClick={() => setActiveMarket("ETH-USDC")}
          >
            ETH / USDC
          </button>
          */}
        </div>
      </section>

      {activeMarket === "CSD-USDC" && (
        <>
          <CsdMarketPanel
            book={csdBook}
            trades={csdTrades}
            onSelectBuy={(offer) => {
              setSelectedSellIntent(offer);
              setSellIntentHash(offer.intentHash);
              setCsdAmount(offer.csdAmount.toString());
              setCsdUsdcAmount(usdc(offer.usdcAmount));
              setCsdMode("buy");
              setStatusMessage("Sell offer selected. Click Buy CSD to authorize purchase.");
            }}
          />

          <section className="card" style={{ marginBottom: 18 }}>
            <div className="faint">CSD / USDC</div>
            <div className="row" style={{ marginTop: 12, marginBottom: 18 }}>
              <button
                className={csdMode === "buy" ? "btn" : "btn secondary"}
                onClick={() => setCsdMode("buy")}
              >
                Buy CSD
              </button>
              <button
                className={csdMode === "sell" ? "btn" : "btn secondary"}
                onClick={() => setCsdMode("sell")}
              >
                Sell CSD
              </button>
            </div>

            {csdMode === "buy" && (
              <div className="grid">
                <h2 style={{ margin: 0 }}>Buy CSD</h2>
<div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
  {sellIntentHash ? (
    <>
      <div className="muted">Selected offer</div>
      <div style={{ marginTop: 8, fontSize: 28 }}>{csd(csdAmount)} CSD</div>
      <div className="muted" style={{ marginTop: 6 }}>
        Price: {csdUsdcAmount} USDC
      </div>
    </>
  ) : (
    <>
      <div className="muted">No offer selected</div>
      <div style={{ marginTop: 8, fontSize: 16, opacity: 0.5 }}>
        Select a sell offer from the book above.
      </div>
    </>
  )}
</div>

                <label>One-time CSD wallet address (addr20)</label>
                <input
                  value={sellerCsdScriptPubKey}
                  onChange={(e) => setSellerCsdScriptPubKey(e.target.value)}
                />

                <button
                  className="btn"
                  onClick={buyCsd}
                  disabled={
                    !sellIntentHash ||
                    !isConnected ||
                    !cfg ||
                    !isValidAddr20(sellerCsdScriptPubKey) ||
                    isApproving ||
                    isCreatingCsdIntent ||
                    isLockingCsdIntent ||
                    !!csdSettlementTx
                  }
                >
                  {isApproving
                    ? "Approving USDC..."
                    : isCreatingCsdIntent
                    ? "Authorizing buy..."
                    : isLockingCsdIntent
                    ? "Locking settlement..."
                    : csdSettlementTx
                    ? "Settled"
                    : csdLockTx
                    ? "Settlement locked"
                    : BigInt(allowances.csdUsdc) < toUsdcInput(csdUsdcAmount)
                    ? "Approve USDC"
                    : "Buy CSD"}
                </button>

{lockedUsdc !== "0" && (
  <div
    className="card"
    style={{
      marginTop:14,
      borderColor:"rgba(255,255,255,0.15)"
    }}
  >
    <div className="faint">
      Settlement lock active
    </div>

    <div
      style={{
        fontSize:24,
        marginTop:8
      }}
    >
      {usdc(lockedUsdc)} USDC reserved
    </div>

  </div>
)}

                {visibleCsdIntentHash && visibleCsdAuthStatus !== "revoked" && (
                  <button
                    className="btn danger"
                    onClick={() => {
                      if (visibleCsdAuthStatus === "settled" || csdSettlementTx) {
                        setStatusMessage("This authorization has already settled.");
                        return;
                      }
                      if (
                        (visibleCsdAuthStatus === "locked" || csdLockTx) &&
                        csdSettlementWindowRemainingMs > 0
                      ) {
                        setStatusMessage(
                          "Settlement lock is active. Revocation is suspended during the bounded proof window."
                        );
                        return;
                      }
                      revokeCsdUsdcAuthorization();
                    }}
                    disabled={isRevoking}
                  >
                    {isRevoking
                      ? "Revoking..."
                      : visibleCsdAuthStatus === "locked" && csdSettlementWindowRemainingMs > 0
                      ? "Revocation locked"
                      : "Revoke buyer authorization"}
                  </button>
                )}

                {csdAuthStatus === "revoked" && (
                  <div
                    className="card"
                    style={{
                      background: "rgba(255,120,140,0.05)",
                      borderColor: "rgba(255,120,140,0.25)",
                    }}
                  >
                    <div className="faint">Authorization revoked</div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      This buy authorization was cancelled. Select an offer and create a new buy
                      authorization.
                    </div>
                  </div>
                )}

                {myActiveCsdBuyIntent && visibleCsdAuthStatus === "active" && (
                  <div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
                    <div className="faint">Buyer authorization active</div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      Authorization expires in:
                    </div>
                    <div style={{ marginTop: 6, fontSize: 22 }}>
                      {formatCountdown(
                        secondsLeft(myActiveCsdBuyIntent.authorization.validBefore)
                      )}
                    </div>
                  </div>
                )}

                {csdLockTx && (
                  <div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
                    <div className="faint">Waiting for seller</div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      Settlement lock is active. Send CSD, then wait for the CSD transaction to
                      be included in a block before submitting the txid.
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      {explorerLink(csdLockTx ?? undefined, "Lock tx")}
                    </div>
                    {csdSettlementWindowRemainingMs > 0 && (
                      <div className="muted" style={{ marginTop: 8 }}>
                        Settlement window: {formatWindow(csdSettlementWindowRemainingMs)} remaining
                      </div>
                    )}
                  </div>
                )}

{myExpiredCsdIntent && (
  <div className="card">
    <div className="faint">
      Settlement expired
    </div>

    <div style={{ marginTop: 8 }}>
      Seller failed to provide valid CSD proof.
    </div>

    <button
      className="btn"
      onClick={refundExpiredLock}
      style={{ marginTop: 14 }}
    >
      Refund locked USDC
    </button>
  </div>
)}

                {csdSettlementTx && (
                  <div
                    className="card"
                    style={{
                      background: "rgba(159,245,200,0.05)",
                      borderColor: "rgba(159,245,200,0.25)",
                    }}
                  >
                    <div className="faint">Settled</div>
                    <div style={{ marginTop: 8 }}>CSD proof matched. USDC settled.</div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      {explorerLink(csdSettlementTx ?? undefined, "Settlement tx")}
                    </div>
                  </div>
                )}
              </div>
            )}

            {csdMode === "sell" && (
              <div className="grid">
                <h2 style={{ margin: 0 }}>Sell CSD</h2>

                <label>Your USDC recipient</label>
                <input
                  value={sellerUsdcRecipient}
                  onChange={(e) => setSellerUsdcRecipient(e.target.value)}
                />

                <label>CSD amount</label>
                <input
                  value={csdAmountHuman}
                  onChange={(e) => setCsdAmountHuman(e.target.value)}
                />

                <label>Price per CSD</label>
                <input
                  value={csdPricePerCoin}
                  onChange={(e) => setCsdPricePerCoin(e.target.value)}
                />

                <div className="muted" style={{ fontSize: 13 }}>
                  Total:{" "}
                  {(Number(csdAmountHuman) * Number(csdPricePerCoin)).toLocaleString()} USDC
                </div>

                <button
                  className="btn"
                  onClick={createCsdSellIntent}
                  disabled={!isConnected || !cfg}
                >
                  Create sell offer
                </button>

                {myActiveCsdSellIntents.length > 0 && (
                  <div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
                    <div className="faint">Your active sell offers</div>
                    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                      {myActiveCsdSellIntents.map((offer: any) => (
                        <div key={offer.intentHash} className="card" style={{ padding: 14 }}>
                          <div className="row space">
                            <div>
                              <strong>{csd(offer.csdAmount)} CSD</strong>
                              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                                {usdPrice(offer.price)} USDC per CSD
                              </div>
                              <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>
                                {short(offer.intentHash)}
                              </div>
                            </div>
                            <button
                              className="btn danger"
                              disabled={offer.status === "locked_for_settlement"}
                              onClick={() => cancelCsdSellIntentByHash(offer.intentHash)}
                            >
                              {offer.status === "locked_for_settlement" ? "Locked" : "Cancel"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

{myCsdSellIntent && (
                  <div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
                    <div className="faint">
{sellerIntentLocked ? "Settlement locked" : "Buyer authorization created"}
                    </div>
<div className="muted" style={{ marginTop: 8 }}>
  {sellerIntentLocked
    ? lockedUsdc !== "0"
      ? "Settlement is locked. USDC is reserved onchain."
      : "Waiting for onchain USDC lock. Do not send CSD yet."
    : "Buyer authorization exists. Lock settlement before sending CSD, then submit the CSD txid."}
</div>
{lockedUsdc !== "0" ? (
  <>
    <div className="muted" style={{ marginTop: 8 }}>
      Send exactly {csd(myLockedCsdSellIntent?.authorization?.csdAmount ?? csdAmount)} CSD to:
    </div>

    <div style={{ marginTop: 8, wordBreak: "break-all", fontSize: 13 }}>
      {myLockedCsdSellIntent?.expectedRecipientScriptPubKey ||
        sellerCsdScriptPubKey ||
        "Waiting for buyer receive script..."}
    </div>
  </>
) : (
  <div className="card" style={{ marginTop: 12 }}>
    <div className="faint">Do not send CSD yet</div>
    <div style={{ marginTop: 8 }}>
      USDC has not been locked onchain.
    </div>
  </div>
)}


{!sellerIntentLocked && (
                      <button
                        className="btn"
                        onClick={lockCsdUsdcIntent}
                        disabled={isLockingCsdIntent}
                      >
                        {isLockingCsdIntent
                          ? "Locking settlement..."
                          : "Lock settlement before sending CSD"}
                      </button>
                    )}

{sellerIntentLocked && (
                      <>
                        {csdSettlementWindowRemainingMs > 0 && (
                          <div
                            className="card"
                            style={{ background: "rgba(255,255,255,0.045)", marginTop: 14 }}
                          >
                            <div className="faint">Settlement window</div>
                            <div style={{ marginTop: 8, fontSize: 22 }}>
                              {formatWindow(csdSettlementWindowRemainingMs)} remaining
                            </div>
                            <div className="muted" style={{ marginTop: 8 }}>
                              Submit the CSD txid before this window closes.
                            </div>
                          </div>
                        )}

                        <label style={{ marginTop: 14 }}>CSD transaction ID</label>
                        <input
                          value={sellerCsdTxid}
                          onChange={(e) => setSellerCsdTxid(e.target.value)}
                          placeholder="0x..."
                        />

                        <button
                          className="btn"
                          onClick={settleCsdUsdcByTxid}
disabled={!sellerCsdTxid || isCsdSettling || lockedUsdc === "0"}
                        >
                          {isCsdSettling ? "Verifying..." : "Verify payment + settle"}
                        </button>

                        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                          If verification fails immediately after sending, wait until the CSD
                          transaction is mined and indexed.
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

{isConnected && address && (

  <BalancePanel

    balances={balances}

    lockedUsdc={lockedUsdc}

  />

)}

      {/*
      {activeMarket === "WBTC-USDC" && (
        <>
          <div className="trade-grid">
            <section className="card grid">
              <h2 style={{ margin: 0 }}>1. Enable trading</h2>
              <p className="muted" style={{ marginTop: -8 }}>
                You are not depositing funds. You are defining what is allowed.
              </p>
              <label>Executor address</label>
              <input value={executor} onChange={(e) => setExecutor(e.target.value as Address)} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label>Max WBTC</label><input value={maxEth} onChange={(e) => setMaxEth(e.target.value)} /></div>
                <div><label>Max USDC</label><input value={maxUsdc} onChange={(e) => setMaxUsdc(e.target.value)} /></div>
                <div><label>Min price</label><input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} /></div>
                <div><label>Max price</label><input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /></div>
                <div><label>Duration seconds</label><input value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
              </div>
              <button className="btn secondary" onClick={approveTokens} disabled={!isConnected || !cfg || isApproving}>
                {isApproving ? "Approving..." : "Approve tokens"}
              </button>
              <button className="btn" onClick={enableTrading} disabled={!isConnected || !cfg || isAuthorizing}>
                {isAuthorizing ? "Authorizing..." : "Enable trading"}
              </button>
              {displayedAuth && (
                <div className="card" style={{ background: "rgba(255,255,255,0.045)" }}>
                  <div className="faint">Authorization active</div>
                  <div style={{ marginTop: 8, wordBreak: "break-all" }}>{displayedAuth.authHash}</div>
                  <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                    Expires in: {formatCountdown(secondsLeft(displayedAuth.auth.validBefore))}
                  </div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                    Remaining boundary: {eth(remainingBase)} WBTC sell capacity / {eth(remainingQuote)} USDC buy capacity
                  </div>
                  <button className="btn danger" onClick={revoke} disabled={isRevoking} style={{ marginTop: 18 }}>
                    {isRevoking ? "Revoking..." : "Revoke authorization"}
                  </button>
                </div>
              )}
            </section>
            <section className="card grid">
              <h2 style={{ margin: 0 }}>2. Place order</h2>
              <p className="muted" style={{ marginTop: -8 }}>
                The order can only execute inside the active authorization.
              </p>
              <label>Side</label>
              <select value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="0">Sell ETH</option>
                <option value="1">Buy ETH</option>
              </select>
              <label>Price</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} />
              <label>Amount ETH</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} />
              {isConnected && address && displayedAuth && (
                <OrderReadinessPanel
                  side={side}
                  amount={amount}
                  price={price}
                  balances={balances}
                  allowances={allowances}
                />
              )}
              <button className="btn" onClick={placeOrder} disabled={!canPlaceOrder || isPlacingOrder}>
                {isPlacingOrder
                  ? "Signing order..."
                  : !isConnected
                  ? "Connect wallet first"
                  : !displayedAuth
                  ? "Enable trading first"
                  : !hasEnoughBalance
                  ? `Insufficient ${orderRequirement.token}`
                  : !hasEnoughAllowance
                  ? `Approve ${orderRequirement.token}`
                  : !hasEnoughAuthCapacity
                  ? "Outside authorization boundary"
                  : "Authorize order"}
              </button>
              <Orderbook book={book} />
            </section>
          </div>
          <FillsTable fills={fills} />
          <OrdersTable
            orders={orders}
            currentAddress={address}
            onCancel={cancelOrder}
            cancellingOrderHash={cancellingOrderHash}
          />
        </>
      )}
      */}

      <section className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Live log</h2>
        <div className="grid">
          {logs.map((l, i) => (
            <div key={i} className="muted" style={{ fontSize: 13 }}>
              {new Date(l.ts).toLocaleTimeString()} — {l.text}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Orderbook({ book }: { book: any }) {
  return (
    <div className="card">
      <div className="row space" style={{ marginBottom: 14 }}>
        <div className="faint">Orderbook</div>
        <div className="muted" style={{ fontSize: 13 }}>ETH / USDC</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div className="muted" style={{ marginBottom: 8 }}>Bids</div>
          {(book.bids || []).length === 0 && <div className="faint">Empty</div>}
          {(book.bids || []).map((b: any) => (
            <div
              key={b.orderHash}
              className="row space"
              style={{ fontSize: 14, marginBottom: 8 }}
            >
              <span>{eth(b.remaining)} ETH</span>
              <span>{eth(b.price)}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="muted" style={{ marginBottom: 8 }}>Asks</div>
          {(book.asks || []).length === 0 && <div className="faint">Empty</div>}
          {(book.asks || []).map((a: any) => (
            <div
              key={a.orderHash}
              className="row space"
              style={{ fontSize: 14, marginBottom: 8 }}
            >
              <span>{eth(a.remaining)} ETH</span>
              <span>{eth(a.price)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrdersTable({
  orders,
  currentAddress,
  onCancel,
  cancellingOrderHash,
}: {
  orders: any[];
  currentAddress?: string;
  onCancel: (orderHash: Hex) => void;
  cancellingOrderHash: Hex | null;
}) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Orders</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {orders.length === 0 && <div className="muted">No orders yet.</div>}
        {orders.map((o) => {
          const remaining = BigInt(o.order.baseAmount) - BigInt(o.filledBaseAmount);
          return (
            <div key={o.orderHash} className="card" style={{ padding: 16 }}>
              <div className="row space">
                <div>
                  <strong>
                    {o.order.side === 0 ? "Sell" : "Buy"} {eth(o.order.baseAmount)} ETH
                  </strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 5 }}>
                    Price {eth(o.order.price)} · Remaining {eth(remaining)} ETH
                  </div>
                </div>
                <div style={{ color: statusStyle(o.status), fontSize: 14 }}>{o.status}</div>
              </div>
              <div className="faint" style={{ marginTop: 10, fontSize: 12 }}>
                {short(o.orderHash)}
              </div>
              {o.order.trader?.toLowerCase() === currentAddress?.toLowerCase() &&
                (o.status === "open" || o.status === "partially_filled") && (
                  <button
                    className="btn danger"
                    style={{ marginTop: 12 }}
                    disabled={
                      cancellingOrderHash?.toLowerCase() === o.orderHash.toLowerCase()
                    }
                    onClick={() => onCancel(o.orderHash)}
                  >
                    {cancellingOrderHash?.toLowerCase() === o.orderHash.toLowerCase()
                      ? "Cancelling..."
                      : "Cancel order"}
                  </button>
                )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BalancePanel({
  balances,
  lockedUsdc,
}:{
  balances:{
    weth:string;
    usdc:string;
    csd:string;
  };
  lockedUsdc:string;
}) {
  return (
<>

    <section className="card" style={{ marginBottom: 18 }}>

      <div className="faint">Ethereum Wallet</div>

      <div style={{ marginTop: 18 }}>

        <div className="muted">USDC Available</div>

        <div style={{ fontSize: 32 }}>

          {usdc(balances.usdc)}

        </div>

      </div>

      <div style={{ marginTop: 18 }}>

        <div className="muted">USDC Locked</div>

        <div style={{ fontSize: 32 }}>

          {usdc(lockedUsdc)}

        </div>

      </div>

    </section>

    <section className="card" style={{ marginBottom: 18 }}>

      <div className="faint">Compute Substrate Wallet</div>

      <div style={{ marginTop: 18 }}>

        <div className="muted">CSD Settled</div>

        <div style={{ fontSize: 32 }}>

          {csd(balances.csd)} CSD

        </div>

      </div>
    </section>
</>

  );

}

function OrderReadinessPanel({
  side,
  amount,
  price,
  balances,
  allowances,
}: {
  side: string;
  amount: string;
  price: string;
  balances: { weth: string; usdc: string };
  allowances: { weth: string; usdc: string };
}) {
  const req = requiredForOrder(side, amount, price);
  const available = req.token === "WETH" ? BigInt(balances.weth) : BigInt(balances.usdc);
  const allowance = req.token === "WETH" ? BigInt(allowances.weth) : BigInt(allowances.usdc);
  const balanceOk = available >= req.required;
  const allowanceOk = allowance >= req.required;
  const ok = balanceOk && allowanceOk;
  return (
    <div
      className="card"
      style={{
        padding: 16,
        borderColor: ok ? "rgba(159,245,200,0.35)" : "rgba(255,120,140,0.35)",
        background: ok ? "rgba(159,245,200,0.035)" : "rgba(255,120,140,0.035)",
      }}
    >
      <div className="faint">Pre-trade check</div>
      <div style={{ marginTop: 10, fontSize: 18, color: ok ? "#9ff5c8" : "#ff9fb0" }}>
        {ok
          ? "Ready to authorize order"
          : !balanceOk
          ? `Insufficient ${req.token}`
          : `Approval required for ${req.token}`}
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        Required: {eth(req.required)} {req.token}
      </div>
      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
        Available: {eth(available)} {req.token} · {balanceOk ? "OK" : "Too low"}
      </div>
      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
        Approved:{" "}
        {allowance > 10n ** 40n ? "Unlimited" : `${eth(allowance)} ${req.token}`} ·{" "}
        {allowanceOk ? "OK" : "Too low"}
      </div>
    </div>
  );
}

function PriceChart({ trades }: { trades: any[] }) {
  const points = [...trades]
    .filter((t) => t.status === "settled")
    .sort((a, b) => tradeTime(a) - tradeTime(b))
    .slice(-50)
    .map((t) => ({
      price: tradePriceNumber(t),
      ts: tradeTime(t),
    }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);

  if (points.length === 0) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="faint">Price chart</div>
        <div className="muted" style={{ marginTop: 12 }}>
          No settled CSD/USDC trades yet.
        </div>
      </div>
    );
  }

  const w = 900;
  const h = 260;
  const pad = 34;

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const path = points
    .map((p, i) => {
      const x =
        points.length === 1
          ? w / 2
          : pad + (i / (points.length - 1)) * (w - pad * 2);

      const y =
        h - pad - ((p.price - min) / range) * (h - pad * 2);

      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const last = points.at(-1)!;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row space" style={{ marginBottom: 12 }}>
        <div>
          <div className="faint">Price chart</div>
          <div style={{ marginTop: 6, fontSize: 28 }}>
            {last.price.toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}{" "}
            USDC
          </div>
        </div>

        <div className="muted" style={{ fontSize: 13 }}>
          Last {points.length} trades
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{
          width: "100%",
          height: 260,
          display: "block",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="currentColor" opacity="0.25" />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" opacity="0.25" />

        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => {
          const x =
            points.length === 1
              ? w / 2
              : pad + (i / (points.length - 1)) * (w - pad * 2);

          const y =
            h - pad - ((p.price - min) / range) * (h - pad * 2);

          return <circle key={i} cx={x} cy={y} r="4" fill="currentColor" />;
        })}

        <text x={pad} y={22} fontSize="14" fill="currentColor" opacity="0.65">
          {max.toLocaleString(undefined, { maximumFractionDigits: 6 })}
        </text>

        <text x={pad} y={h - 8} fontSize="14" fill="currentColor" opacity="0.65">
          {min.toLocaleString(undefined, { maximumFractionDigits: 6 })}
        </text>
      </svg>
    </div>
  );
}

function CsdMarketPanel({
  book,
  trades,
  onSelectBuy,
}: {
  book: any;
  trades: any[];
  onSelectBuy?: (offer: any) => void;
}) {
  const last = trades[0];
  const volume24h = trades
    .filter((t) => Number(t.settledAt ?? 0) > Date.now() - 24 * 60 * 60 * 1000)
    .reduce((sum, t) => sum + BigInt(t.baseAmount), 0n);
  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="faint">CSD / USDC market</div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}
      >
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 13 }}>Last price</div>
          <div style={{ fontSize: 24, marginTop: 6 }}>
            {last ? `${usdPrice(last.price)} USDC` : "—"}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 13 }}>24h volume</div>
          <div style={{ fontSize: 24, marginTop: 6 }}>{csd(volume24h)} CSD</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: 13 }}>Open sell intents</div>
          <div style={{ fontSize: 24, marginTop: 6 }}>{book.asks?.length ?? 0}</div>
        </div>
      </div>

      <PriceChart trades={trades} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row space" style={{ marginBottom: 14 }}>
          <div className="faint">CSD sell book</div>
          <div className="muted" style={{ fontSize: 13 }}>CSD / USDC</div>
        </div>
        {(book.asks || []).length === 0 && (
          <div className="muted">No open CSD sell intents.</div>
        )}
        {(book.asks || []).map((a: any) => (
          <div
            key={a.intentHash}
            className="row space"
            style={{ fontSize: 14, marginBottom: 8 }}
          >
            <span>{csd(a.csdAmount)} CSD</span>
            <span>{usdPrice(a.price)} USDC</span>
            {onSelectBuy && (
              <button className="btn secondary" onClick={() => onSelectBuy(a)}>
                Buy
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="faint" style={{ marginBottom: 14 }}>Recent CSD trades</div>
        {trades.length === 0 && <div className="muted">No CSD trades yet.</div>}
        {trades.slice(0, 20).map((t) => (
          <div
            key={t.fillNonce}
            className="row space"
            style={{ fontSize: 14, marginBottom: 8 }}
          >
            <span>{csd(t.baseAmount)} CSD</span>
            <span>{usdPrice(t.price)} USDC</span>
            <span className="muted">{explorerLink(t.txHash, "USDC")}</span>
            {t.csdTxid && (
              <span className="muted">{csdExplorerLink(t.csdTxid, "CSD")}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function FillsTable({ fills }: { fills: any[] }) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Settled fills</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {fills.length === 0 && <div className="muted">No fills yet.</div>}
        {fills.map((f) => (
          <div key={f.fillNonce} className="card" style={{ padding: 16 }}>
            <div className="row space">
              <div>
                <strong>
                  {eth(f.baseAmount)} ETH @ {eth(f.price)}
                </strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 5 }}>
                  Quote {eth(f.quoteAmount)} USDC
                </div>
              </div>
              <div style={{ color: statusStyle(f.status), fontSize: 14 }}>{f.status}</div>
            </div>
            {f.txHash && (
              <div className="faint" style={{ marginTop: 10, fontSize: 12 }}>
                tx{" "}
                {txUrl(f.txHash) ? (
                  <a href={txUrl(f.txHash)!} target="_blank" rel="noreferrer">
                    {short(f.txHash)}
                  </a>
                ) : (
                  short(f.txHash)
                )}
              </div>
            )}
            {f.status === "rejected" && (
              <div className="muted" style={{ marginTop: 8, fontSize: 13, color: "#ff9fb0" }}>
                {readableError(f.error)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
