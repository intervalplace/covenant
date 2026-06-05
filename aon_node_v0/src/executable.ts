import { AonObject } from "./object.js";

export function findExecutableGraphs(objects: AonObject[]) {
  const authorizations = objects.filter((o) => o.objectType === "authorization");
  const conditions = objects.filter((o) => o.objectType === "condition");
  const proofs = objects.filter((o) => o.objectType === "proof");
  const receipts = objects.filter((o) => o.objectType === "receipt");

  const receiptRefs = new Set(
    receipts.flatMap((r) => r.references.map((x) => x.toLowerCase()))
  );

  const executable = [];

  for (const auth of authorizations) {
    if (!auth.objectHash) continue;

    const relatedConditions = conditions.filter((c) =>
      c.references.map((r) => r.toLowerCase()).includes(auth.objectHash!.toLowerCase())
    );

    for (const condition of relatedConditions) {
      if (!condition.objectHash) continue;

      const relatedProofs = proofs.filter((p) =>
        p.references.map((r) => r.toLowerCase()).includes(condition.objectHash!.toLowerCase())
      );

      for (const proof of relatedProofs) {
        if (!proof.objectHash) continue;

        const alreadyReceipted =
          receiptRefs.has(auth.objectHash.toLowerCase()) &&
          receiptRefs.has(condition.objectHash.toLowerCase()) &&
          receiptRefs.has(proof.objectHash.toLowerCase());

        executable.push({
          status: alreadyReceipted ? "completed" : "executable",
          authorization: auth,
          condition,
          proof,
        });
      }
    }
  }

  return executable;
}
