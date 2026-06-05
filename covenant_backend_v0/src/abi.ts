export const settlementAbi = [
  {
    type: "function",
    name: "hashTradingSessionAuthorization",
    stateMutability: "view",
    inputs: [{
      name: "auth",
      type: "tuple",
      components: [
        { name: "grantor", type: "address" },
        { name: "executor", type: "address" },
        { name: "settlementContract", type: "address" },
        { name: "baseToken", type: "address" },
        { name: "quoteToken", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "sideMask", type: "uint8" },
        { name: "maxBaseExposure", type: "uint256" },
        { name: "maxQuoteExposure", type: "uint256" },
        { name: "minPrice", type: "uint256" },
        { name: "maxPrice", type: "uint256" },
        { name: "validAfter", type: "uint64" },
        { name: "validBefore", type: "uint64" },
        { name: "authNonce", type: "bytes32" }
      ]
    }],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    name: "hashSignedOrder",
    stateMutability: "view",
    inputs: [{
      name: "order",
      type: "tuple",
      components: [
        { name: "trader", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "side", type: "uint8" },
        { name: "orderType", type: "uint8" },
        { name: "price", type: "uint256" },
        { name: "baseAmount", type: "uint256" },
        { name: "timeInForce", type: "uint8" },
        { name: "orderNonce", type: "bytes32" },
        { name: "sessionAuthHash", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "validBefore", type: "uint64" }
      ]
    }],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    name: "settleSpotTrade",
    stateMutability: "nonpayable",
    inputs: [
      { name: "makerAuth", type: "tuple", components: [
        { name: "grantor", type: "address" }, { name: "executor", type: "address" }, { name: "settlementContract", type: "address" }, { name: "baseToken", type: "address" }, { name: "quoteToken", type: "address" }, { name: "marketId", type: "bytes32" }, { name: "sideMask", type: "uint8" }, { name: "maxBaseExposure", type: "uint256" }, { name: "maxQuoteExposure", type: "uint256" }, { name: "minPrice", type: "uint256" }, { name: "maxPrice", type: "uint256" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "authNonce", type: "bytes32" }
      ] },
      { name: "makerAuthSig", type: "bytes" },
      { name: "makerOrder", type: "tuple", components: [
        { name: "trader", type: "address" }, { name: "marketId", type: "bytes32" }, { name: "side", type: "uint8" }, { name: "orderType", type: "uint8" }, { name: "price", type: "uint256" }, { name: "baseAmount", type: "uint256" }, { name: "timeInForce", type: "uint8" }, { name: "orderNonce", type: "bytes32" }, { name: "sessionAuthHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }
      ] },
      { name: "makerOrderSig", type: "bytes" },
      { name: "takerAuth", type: "tuple", components: [
        { name: "grantor", type: "address" }, { name: "executor", type: "address" }, { name: "settlementContract", type: "address" }, { name: "baseToken", type: "address" }, { name: "quoteToken", type: "address" }, { name: "marketId", type: "bytes32" }, { name: "sideMask", type: "uint8" }, { name: "maxBaseExposure", type: "uint256" }, { name: "maxQuoteExposure", type: "uint256" }, { name: "minPrice", type: "uint256" }, { name: "maxPrice", type: "uint256" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "authNonce", type: "bytes32" }
      ] },
      { name: "takerAuthSig", type: "bytes" },
      { name: "takerOrder", type: "tuple", components: [
        { name: "trader", type: "address" }, { name: "marketId", type: "bytes32" }, { name: "side", type: "uint8" }, { name: "orderType", type: "uint8" }, { name: "price", type: "uint256" }, { name: "baseAmount", type: "uint256" }, { name: "timeInForce", type: "uint8" }, { name: "orderNonce", type: "bytes32" }, { name: "sessionAuthHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }
      ] },
      { name: "takerOrderSig", type: "bytes" },
      { name: "fill", type: "tuple", components: [
        { name: "makerOrderHash", type: "bytes32" }, { name: "takerOrderHash", type: "bytes32" }, { name: "makerAuthHash", type: "bytes32" }, { name: "takerAuthHash", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "baseAmount", type: "uint256" }, { name: "quoteAmount", type: "uint256" }, { name: "fillNonce", type: "bytes32" }
      ] }
    ],
    outputs: []
  }
] as const;

export const registryAbi = [
  { type: "function", name: "revokedAuth", stateMutability: "view", inputs: [{ name: "authHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "cancelledOrder", stateMutability: "view", inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
 {
  type: "function",
  name: "registerAuthorization",
  stateMutability: "nonpayable",
  inputs: [
    { name: "authHash", type: "bytes32" },
    { name: "authorizer", type: "address" },
  ],
  outputs: [],
},
 {
  type: "function",
  name: "revokeAuthorization",
  stateMutability: "nonpayable",
  inputs: [{ name: "authHash", type: "bytes32" }],
  outputs: [],
},
] as const;

export const csdUsdcSettlementAbi = [
  {
    type: "function",
    name: "hashCsdUsdcAuthorization",
    stateMutability: "view",
    inputs: [
      {
        name: "auth",
        type: "tuple",
        components: [
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
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },

{
  type: "function",
  name: "lockCsdUsdcAuthorization",
  stateMutability: "nonpayable",
  inputs: [
    {
      name: "auth",
      type: "tuple",
      components: [
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
    },
    { name: "authSig", type: "bytes" },
  ],
  outputs: [],
},

  {
    type: "function",
    name: "settleCsdUsdc",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "auth",
        type: "tuple",
        components: [
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
      },
      { name: "authSig", type: "bytes" },
      {
        name: "proof",
        type: "tuple",
        components: [
          { name: "csdTxid", type: "bytes32" },
	  { name: "csdGenesisHash", type: "bytes32" },  
          { name: "sellerCsdScriptHash", type: "bytes32" },
          { name: "tradeIntentHash", type: "bytes32" },
          { name: "csdAmount", type: "uint256" },
          { name: "confirmations", type: "uint256" },
          { name: "blockHash", type: "bytes32" },
          { name: "blockHeight", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },

{
  type: "function",
  name: "lockedBalance",
  stateMutability: "view",
  inputs: [{ name: "authHash", type: "bytes32" }],
  outputs: [{ name: "", type: "uint256" }],
},
{
  type: "function",
  name: "refundExpiredLock",
  stateMutability: "nonpayable",
  inputs: [
    {
      name: "auth",
      type: "tuple",
      components: [
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
        { name: "nonce", type: "bytes32" }
      ]
    }
  ],
  outputs: [],
},

  { type: "error", name: "UnauthorizedExecutor", inputs: [] },
  { type: "error", name: "BadSignature", inputs: [] },
  { type: "error", name: "AuthorizationRevoked", inputs: [{ name: "authHash", type: "bytes32" }] },
  { type: "error", name: "AuthorizationExpired", inputs: [{ name: "authHash", type: "bytes32" }] },
  { type: "error", name: "AuthorizationAlreadyFinalized", inputs: [{ name: "authHash", type: "bytes32" }] },
  { type: "error", name: "InvalidProofAttestation", inputs: [] },
  { type: "error", name: "InsufficientConfirmations", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "CsdTxAlreadyConsumed", inputs: [{ name: "csdTxid", type: "bytes32" }] },
  { type: "error", name: "AuthorizationNotLocked", inputs: [{ name: "authHash", type: "bytes32" }] },
] as const;


// src/abi.ts
export const mockErc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
