import { JSONFilePreset } from "lowdb/node";
import fs from "fs/promises";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data/covenant-db.json");

type DbData = {
  csdSellIntents: any[];
  csdUsdcIntents: any[];
  fills: any[];
};

await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

export const db = await JSONFilePreset<DbData>(DB_PATH, {
  csdSellIntents: [],
  csdUsdcIntents: [],
  fills: [],
});

let saveQueue = Promise.resolve();

export function saveDb() {
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

    const tmp = path.join(
      path.dirname(DB_PATH),
      `.${path.basename(DB_PATH)}.${process.pid}.${Date.now()}.tmp`
    );

    await fs.writeFile(tmp, JSON.stringify(db.data, null, 2));
    await fs.rename(tmp, DB_PATH);
  });

  return saveQueue;
}

console.log("[db] using", DB_PATH);
