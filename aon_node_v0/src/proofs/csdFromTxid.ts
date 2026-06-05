import type { AonObject } from "../object.js";
import { finalizeObject } from "../object.js";

export async function fetchCsdProofByTxid(txid: string) {
  const base = process.env.CSD_RPC_URL ?? "http://141.94.163.242:8888";
  const res = await fetch(`${base}/proof/tx/${txid}`);

  if (!res.ok) {
    throw new Error(`CSD_PROOF_FETCH_FAILED_${res.status}`);
  }

  return await res.json();
}

export async function makeCsdPaymentProofObject(args: {
  conditionHash: string;
  txid: string;
  expectedRecipientScriptPubKey?: string;
  expectedAmount?: string | number | bigint;
  minConfirmations?: number;
  expectedIntentHash?: string;
}) {
  const proof = await fetchCsdProofByTxid(args.txid);

  return finalizeObject({
    type: "proof",
    namespace: "csd",
    proofType: "csd_payment",
    refs: [args.conditionHash],
    payload: {
      txid: args.txid,
      proof,
      expectedRecipientScriptPubKey: args.expectedRecipientScriptPubKey,
      expectedAmount:
        args.expectedAmount !== undefined
          ? String(args.expectedAmount)
          : undefined,
      minConfirmations: args.minConfirmations ?? 6,
      expectedIntentHash: args.expectedIntentHash,
    },
    createdAt: Date.now(),
  } as any);
}
