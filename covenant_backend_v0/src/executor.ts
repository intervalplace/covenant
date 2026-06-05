import type { Hex } from "viem";
import { config, publicClient, walletClient } from "./chain.js";
import { settlementAbi } from "./abi.js";
import { auths, orders, fills } from "./state.js";
import type { ProposedFill, FillRecord } from "./types.js";

export async function executeFill(fill: ProposedFill): Promise<FillRecord> {
  const makerOrder = orders.get(fill.makerOrderHash);
  const takerOrder = orders.get(fill.takerOrderHash);
  const makerAuth = auths.get(fill.makerAuthHash);
  const takerAuth = auths.get(fill.takerAuthHash);

  const record: FillRecord = { ...fill, status: "proposed", createdAt: Math.floor(Date.now() / 1000) };
  fills.set(fill.fillNonce, record);

  try {
    if (!makerOrder || !takerOrder || !makerAuth || !takerAuth) throw new Error("Missing order/auth for fill");
    record.status = "submitted_for_settlement";

    const hash = await walletClient.writeContract({
      address: config.settlement,
      abi: settlementAbi,
      functionName: "settleSpotTrade",
      args: [
        makerAuth.auth as any,
        makerAuth.signature,
        makerOrder.order as any,
        makerOrder.signature,
        takerAuth.auth as any,
        takerAuth.signature,
        takerOrder.order as any,
        takerOrder.signature,
        fill,
      ],
    });

    record.txHash = hash as Hex;
    await publicClient.waitForTransactionReceipt({ hash });
    record.status = "settled";

    makerOrder.filledBaseAmount += fill.baseAmount;
    takerOrder.filledBaseAmount += fill.baseAmount;
    makerOrder.status = makerOrder.filledBaseAmount >= makerOrder.order.baseAmount ? "filled" : "partially_filled";
    takerOrder.status = takerOrder.filledBaseAmount >= takerOrder.order.baseAmount ? "filled" : "partially_filled";
    return record;
  } catch (err) {

    record.status = "rejected";
    record.error = err instanceof Error ? err.message : String(err);

const makerOrder = orders.get(fill.makerOrderHash);
const takerOrder = orders.get(fill.takerOrderHash);

if (makerOrder) makerOrder.status = "dead";
if (takerOrder) takerOrder.status = "dead";

    return record;
  }
}
