// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CovenantAuthorizationRegistry.sol";

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CovenantSpotSettlement {
    CovenantAuthorizationRegistry public immutable registry;

    bytes32 public constant AUTH_TYPEHASH = keccak256(
        "TradingSessionAuthorization(address grantor,address executor,address settlementContract,address baseToken,address quoteToken,bytes32 marketId,uint8 sideMask,uint256 maxBaseExposure,uint256 maxQuoteExposure,uint256 minPrice,uint256 maxPrice,uint64 validAfter,uint64 validBefore,bytes32 authNonce)"
    );

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "SignedOrder(address trader,bytes32 marketId,uint8 side,uint8 orderType,uint256 price,uint256 baseAmount,uint8 timeInForce,bytes32 orderNonce,bytes32 sessionAuthHash,uint64 validAfter,uint64 validBefore)"
    );

    bytes32 private immutable DOMAIN_SEPARATOR;

    uint8 public constant SIDE_SELL_BASE = 0;
    uint8 public constant SIDE_BUY_BASE = 1;

    mapping(bytes32 => uint256) public usedBaseByAuth;
    mapping(bytes32 => uint256) public usedQuoteByAuth;
    mapping(bytes32 => uint256) public filledBaseByOrder;
    mapping(bytes32 => bool) public usedFillNonce;

    struct TradingSessionAuthorization {
        address grantor;
        address executor;
        address settlementContract;
        address baseToken;
        address quoteToken;
        bytes32 marketId;
        uint8 sideMask;
        uint256 maxBaseExposure;
        uint256 maxQuoteExposure;
        uint256 minPrice;
        uint256 maxPrice;
        uint64 validAfter;
        uint64 validBefore;
        bytes32 authNonce;
    }

    struct SignedOrder {
        address trader;
        bytes32 marketId;
        uint8 side;
        uint8 orderType;
        uint256 price;
        uint256 baseAmount;
        uint8 timeInForce;
        bytes32 orderNonce;
        bytes32 sessionAuthHash;
        uint64 validAfter;
        uint64 validBefore;
    }

    struct FillInstruction {
        bytes32 makerOrderHash;
        bytes32 takerOrderHash;
        bytes32 makerAuthHash;
        bytes32 takerAuthHash;
        uint256 price;
        uint256 baseAmount;
        uint256 quoteAmount;
        bytes32 fillNonce;
    }

    event SpotTradeSettled(bytes32 indexed fillNonce, bytes32 indexed makerOrderHash, bytes32 indexed takerOrderHash, bytes32 makerAuthHash, bytes32 takerAuthHash, address maker, address taker, address baseToken, address quoteToken, uint256 price, uint256 baseAmount, uint256 quoteAmount);
    event AuthorizationConsumed(bytes32 indexed authHash, uint256 baseDelta, uint256 quoteDelta, uint256 cumulativeBase, uint256 cumulativeQuote);
    event OrderFilled(bytes32 indexed orderHash, uint256 fillBase, uint256 cumulativeFilledBase);

    error UnauthorizedExecutor();
    error BadSignature();
    error InvalidSettlementContract();
    error AuthorizationRevoked(bytes32 authHash);
    error OrderCancelled(bytes32 orderHash);
    error AuthorizationExpired(bytes32 authHash);
    error OrderExpired(bytes32 orderHash);
    error InvalidMarket();
    error InvalidSide();
    error InvalidPrice();
    error AuthExposureExceeded(bytes32 authHash);
    error OrderAmountExceeded(bytes32 orderHash);
    error FillReplay(bytes32 fillNonce);
    error TransferFailed();

    constructor(address registry_) {
        registry = CovenantAuthorizationRegistry(registry_);
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Covenant")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function domainSeparator() external view returns (bytes32) { return DOMAIN_SEPARATOR; }

    function hashTradingSessionAuthorization(TradingSessionAuthorization memory auth) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AUTH_TYPEHASH, auth.grantor, auth.executor, auth.settlementContract, auth.baseToken, auth.quoteToken, auth.marketId, auth.sideMask, auth.maxBaseExposure, auth.maxQuoteExposure, auth.minPrice, auth.maxPrice, auth.validAfter, auth.validBefore, auth.authNonce));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function hashSignedOrder(SignedOrder memory order) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ORDER_TYPEHASH, order.trader, order.marketId, order.side, order.orderType, order.price, order.baseAmount, order.timeInForce, order.orderNonce, order.sessionAuthHash, order.validAfter, order.validBefore));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function settleSpotTrade(
        TradingSessionAuthorization calldata makerAuth,
        bytes calldata makerAuthSig,
        SignedOrder calldata makerOrder,
        bytes calldata makerOrderSig,
        TradingSessionAuthorization calldata takerAuth,
        bytes calldata takerAuthSig,
        SignedOrder calldata takerOrder,
        bytes calldata takerOrderSig,
        FillInstruction calldata fill
    ) external {
        if (!registry.trustedExecutor(msg.sender)) revert UnauthorizedExecutor();

        bytes32 makerAuthHash = hashTradingSessionAuthorization(makerAuth);
        bytes32 takerAuthHash = hashTradingSessionAuthorization(takerAuth);
        bytes32 makerOrderHash = hashSignedOrder(makerOrder);
        bytes32 takerOrderHash = hashSignedOrder(takerOrder);

        if (fill.makerAuthHash != makerAuthHash || fill.takerAuthHash != takerAuthHash) revert InvalidMarket();
        if (fill.makerOrderHash != makerOrderHash || fill.takerOrderHash != takerOrderHash) revert InvalidMarket();
        if (usedFillNonce[fill.fillNonce]) revert FillReplay(fill.fillNonce);

        _verifyAuth(makerAuth, makerAuthSig, makerAuthHash);
        _verifyAuth(takerAuth, takerAuthSig, takerAuthHash);
        _verifyOrder(makerOrder, makerOrderSig, makerOrderHash, makerAuthHash, makerAuth);
        _verifyOrder(takerOrder, takerOrderSig, takerOrderHash, takerAuthHash, takerAuth);
        _verifyFill(makerAuth, makerOrder, takerAuth, takerOrder, fill);


        if (filledBaseByOrder[makerOrderHash] + fill.baseAmount > makerOrder.baseAmount) {
            revert OrderAmountExceeded(makerOrderHash);
        }

        if (filledBaseByOrder[takerOrderHash] + fill.baseAmount > takerOrder.baseAmount) {
            revert OrderAmountExceeded(takerOrderHash);
        }

        usedFillNonce[fill.fillNonce] = true;

        _consumeExposure(makerAuthHash, makerAuth, makerOrder, fill);
        _consumeExposure(takerAuthHash, takerAuth, takerOrder, fill);

        filledBaseByOrder[makerOrderHash] += fill.baseAmount;
        filledBaseByOrder[takerOrderHash] += fill.baseAmount;

        address seller;
        address buyer;
        if (makerOrder.side == SIDE_SELL_BASE && takerOrder.side == SIDE_BUY_BASE) { seller = makerAuth.grantor; buyer = takerAuth.grantor; }
        else if (makerOrder.side == SIDE_BUY_BASE && takerOrder.side == SIDE_SELL_BASE) { seller = takerAuth.grantor; buyer = makerAuth.grantor; }
        else revert InvalidSide();

        if (!IERC20Like(makerAuth.baseToken).transferFrom(seller, buyer, fill.baseAmount)) revert TransferFailed();
        if (!IERC20Like(makerAuth.quoteToken).transferFrom(buyer, seller, fill.quoteAmount)) revert TransferFailed();


        emit OrderFilled(makerOrderHash, fill.baseAmount, filledBaseByOrder[makerOrderHash]);
        emit OrderFilled(takerOrderHash, fill.baseAmount, filledBaseByOrder[takerOrderHash]);
        emit SpotTradeSettled(fill.fillNonce, makerOrderHash, takerOrderHash, makerAuthHash, takerAuthHash, makerAuth.grantor, takerAuth.grantor, makerAuth.baseToken, makerAuth.quoteToken, fill.price, fill.baseAmount, fill.quoteAmount);
    }

    function _verifyAuth(TradingSessionAuthorization calldata auth, bytes calldata sig, bytes32 authHash) internal view {
        if (auth.settlementContract != address(this)) revert InvalidSettlementContract();
        if (auth.executor != msg.sender) revert UnauthorizedExecutor();
        if (registry.revokedAuth(authHash)) revert AuthorizationRevoked(authHash);
        if (block.timestamp < auth.validAfter || block.timestamp > auth.validBefore) revert AuthorizationExpired(authHash);
        if (_recover(authHash, sig) != auth.grantor) revert BadSignature();
    }

    function _verifyOrder(SignedOrder calldata order, bytes calldata sig, bytes32 orderHash, bytes32 authHash, TradingSessionAuthorization calldata auth) internal view {
        if (order.trader != auth.grantor) revert BadSignature();
        if (order.marketId != auth.marketId) revert InvalidMarket();
        if (order.sessionAuthHash != authHash) revert InvalidMarket();
        if (registry.cancelledOrder(orderHash)) revert OrderCancelled(orderHash);
        if (block.timestamp < order.validAfter || block.timestamp > order.validBefore) revert OrderExpired(orderHash);
        if (_recover(orderHash, sig) != order.trader) revert BadSignature();
    }

    function _verifyFill(TradingSessionAuthorization calldata makerAuth, SignedOrder calldata makerOrder, TradingSessionAuthorization calldata takerAuth, SignedOrder calldata takerOrder, FillInstruction calldata fill) internal pure {
        if (makerAuth.marketId != takerAuth.marketId) revert InvalidMarket();
        if (makerAuth.baseToken != takerAuth.baseToken || makerAuth.quoteToken != takerAuth.quoteToken) revert InvalidMarket();
        if (makerOrder.marketId != takerOrder.marketId || makerOrder.marketId != makerAuth.marketId) revert InvalidMarket();
        if (makerOrder.side == takerOrder.side) revert InvalidSide();
        if (!_sideAllowed(makerAuth.sideMask, makerOrder.side)) revert InvalidSide();
        if (!_sideAllowed(takerAuth.sideMask, takerOrder.side)) revert InvalidSide();
if (makerOrder.side == SIDE_SELL_BASE && takerOrder.side == SIDE_BUY_BASE) {
    if (fill.price < makerOrder.price) revert InvalidPrice();
    if (fill.price > takerOrder.price) revert InvalidPrice();
} else if (makerOrder.side == SIDE_BUY_BASE && takerOrder.side == SIDE_SELL_BASE) {
    if (fill.price > makerOrder.price) revert InvalidPrice();
    if (fill.price < takerOrder.price) revert InvalidPrice();
} else {
    revert InvalidSide();
}
        if (fill.price < makerAuth.minPrice || fill.price > makerAuth.maxPrice) revert InvalidPrice();
        if (fill.price < takerAuth.minPrice || fill.price > takerAuth.maxPrice) revert InvalidPrice();
        if ((fill.baseAmount * fill.price) / 1e18 != fill.quoteAmount) revert InvalidPrice();
    }

    function _consumeExposure(
        bytes32 authHash,
        TradingSessionAuthorization calldata auth,
        SignedOrder calldata order,
        FillInstruction calldata fill
    ) internal {
        if (order.side == SIDE_SELL_BASE) {
            uint256 nextBase = usedBaseByAuth[authHash] + fill.baseAmount;
            if (nextBase > auth.maxBaseExposure) revert AuthExposureExceeded(authHash);

            usedBaseByAuth[authHash] = nextBase;

            emit AuthorizationConsumed(
                authHash,
                fill.baseAmount,
                0,
                usedBaseByAuth[authHash],
                usedQuoteByAuth[authHash]
            );
        } else if (order.side == SIDE_BUY_BASE) {
            uint256 nextQuote = usedQuoteByAuth[authHash] + fill.quoteAmount;
            if (nextQuote > auth.maxQuoteExposure) revert AuthExposureExceeded(authHash);

            usedQuoteByAuth[authHash] = nextQuote;

            emit AuthorizationConsumed(
                authHash,
                0,
                fill.quoteAmount,
                usedBaseByAuth[authHash],
                usedQuoteByAuth[authHash]
            );
        } else {
            revert InvalidSide();
        }
    }

    function _sideAllowed(uint8 sideMask, uint8 side) internal pure returns (bool) {
        if (side == SIDE_BUY_BASE) return (sideMask & 1) != 0;
        if (side == SIDE_SELL_BASE) return (sideMask & 2) != 0;
        return false;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}

