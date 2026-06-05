export function validateCsdUsdcSettlementAuthorization(auth) {
    const now = Math.floor(Date.now() / 1000);
    if (!auth.sellerCsdScriptHash || auth.sellerCsdScriptHash.length !== 66)
        throw new Error("INVALID_SELLER_CSD_SCRIPT_HASH");
    if (!auth.csdGenesisHash || auth.csdGenesisHash.length !== 66)
        throw new Error("INVALID_CSD_GENESIS_HASH");
    if (!auth.tradeIntentHash || auth.tradeIntentHash.length !== 66)
        throw new Error("INVALID_TRADE_INTENT_HASH");
    if (!auth.nonce || auth.nonce.length !== 66)
        throw new Error("INVALID_NONCE");
    if (now < Number(auth.validAfter))
        throw new Error("SETTLEMENT_AUTH_NOT_YET_VALID");
    if (now > Number(auth.validBefore))
        throw new Error("SETTLEMENT_AUTH_EXPIRED");
    if (BigInt(auth.csdAmount) <= 0n)
        throw new Error("INVALID_CSD_AMOUNT");
    if (BigInt(auth.usdcAmount) <= 0n)
        throw new Error("INVALID_USDC_AMOUNT");
    if (BigInt(auth.minConfirmations) < 1n)
        throw new Error("INVALID_MIN_CONFIRMATIONS");
    return true;
}
