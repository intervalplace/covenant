import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Address, type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  rpcUrl: mustEnv("RPC_URL"),
  port: Number(process.env.PORT ?? "8787"),
  registry: mustEnv("REGISTRY") as Address,
  settlement: mustEnv("SETTLEMENT") as Address,
csdUsdcSettlement: getAddress(mustEnv("CSD_USDC_SETTLEMENT")),
  weth: mustEnv("WETH") as Address,
  usdc: mustEnv("USDC") as Address,
  executorPrivateKey: mustEnv("EXECUTOR_PRIVATE_KEY") as Hex,
};

export const executorAccount = privateKeyToAccount(config.executorPrivateKey);

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
  account: executorAccount,
  chain: mainnet,
  transport: http(config.rpcUrl),
});
