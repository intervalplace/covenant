import { config, publicClient, walletClient } from "./chain.js";
import { settlementAbi } from "./abi.js";
import { auths, orders, fills } from "./state.js";
export async function executeFill(fill) {
    const makerOrder = orders.get(fill.makerOrderHash);
    const takerOrder = orders.get(fill.takerOrderHash);
    const makerAuth = auths.get(fill.makerAuthHash);
    const takerAuth = auths.get(fill.takerAuthHash);
    const record = { ...fill, status: "proposed", createdAt: Math.floor(Date.now() / 1000) };
    fills.set(fill.fillNonce, record);
    try {
        if (!makerOrder || !takerOrder || !makerAuth || !takerAuth)
            throw new Error("Missing order/auth for fill");
        record.status = "submitted_for_settlement";
        const hash = await walletClient.writeContract({
            address: config.settlement,
            abi: settlementAbi,
            functionName: "settleSpotTrade",
            args: [
                makerAuth.auth,
                makerAuth.signature,
                makerOrder.order,
                makerOrder.signature,
                takerAuth.auth,
                takerAuth.signature,
                takerOrder.order,
                takerOrder.signature,
                fill,
            ],
        });
        record.txHash = hash;
        await publicClient.waitForTransactionReceipt({ hash });
        record.status = "settled";
        makerOrder.filledBaseAmount += fill.baseAmount;
        takerOrder.filledBaseAmount += fill.baseAmount;
        makerOrder.status = makerOrder.filledBaseAmount >= makerOrder.order.baseAmount ? "filled" : "partially_filled";
        takerOrder.status = takerOrder.filledBaseAmount >= takerOrder.order.baseAmount ? "filled" : "partially_filled";
        return record;
    }
    catch (err) {
        record.status = "rejected";
        record.error = err instanceof Error ? err.message : String(err);
        const makerOrder = orders.get(fill.makerOrderHash);
        const takerOrder = orders.get(fill.takerOrderHash);
        if (makerOrder)
            makerOrder.status = "dead";
        if (takerOrder)
            takerOrder.status = "dead";
        return record;
    }
}
