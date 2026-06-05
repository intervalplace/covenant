// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/CovenantAuthorizationRegistry.sol";
import "../src/CovenantSpotSettlement.sol";
import "../src/MockERC20.sol";

contract CovenantTest is Test {
    CovenantAuthorizationRegistry registry;
    CovenantSpotSettlement settlement;
    MockERC20 weth;
    MockERC20 usdc;

    uint256 makerPk = 0xA11CE;
    uint256 takerPk = 0xB0B;
    uint256 executorPk = 0xEEC;

    address maker;
    address taker;
    address executor;
    bytes32 marketId = keccak256("ETH-USDC-SPOT");

    function setUp() public {
        maker = vm.addr(makerPk);
        taker = vm.addr(takerPk);
        executor = vm.addr(executorPk);

        registry = new CovenantAuthorizationRegistry();
        settlement = new CovenantSpotSettlement(address(registry));
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 18);

        registry.setTrustedExecutor(executor, true);
        weth.mint(maker, 10 ether);
        usdc.mint(taker, 100_000 ether);

        vm.prank(maker);
        weth.approve(address(settlement), type(uint256).max);
        vm.prank(taker);
        usdc.approve(address(settlement), type(uint256).max);

        vm.warp(1_800_000_000);
    }

    function testSettlesSpotTrade() public {
        (CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth, bytes memory makerAuthSig, CovenantSpotSettlement.SignedOrder memory makerOrder, bytes memory makerOrderSig, CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth, bytes memory takerAuthSig, CovenantSpotSettlement.SignedOrder memory takerOrder, bytes memory takerOrderSig, CovenantSpotSettlement.FillInstruction memory fill) = _buildTrade();

        vm.prank(executor);
        settlement.settleSpotTrade(makerAuth, makerAuthSig, makerOrder, makerOrderSig, takerAuth, takerAuthSig, takerOrder, takerOrderSig, fill);

        assertEq(weth.balanceOf(maker), 9 ether);
        assertEq(usdc.balanceOf(maker), 3_000 ether);
        assertEq(weth.balanceOf(taker), 1 ether);
        assertEq(usdc.balanceOf(taker), 97_000 ether);
    }

    function testRevocationKillsExecution() public {
        (CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth, bytes memory makerAuthSig, CovenantSpotSettlement.SignedOrder memory makerOrder, bytes memory makerOrderSig, CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth, bytes memory takerAuthSig, CovenantSpotSettlement.SignedOrder memory takerOrder, bytes memory takerOrderSig, CovenantSpotSettlement.FillInstruction memory fill) = _buildTrade();
        bytes32 makerAuthHash = settlement.hashTradingSessionAuthorization(makerAuth);

        vm.prank(maker);
        registry.revokeAuthorization(makerAuthHash);

        vm.prank(executor);
        vm.expectRevert();
        settlement.settleSpotTrade(makerAuth, makerAuthSig, makerOrder, makerOrderSig, takerAuth, takerAuthSig, takerOrder, takerOrderSig, fill);
    }

    function testPartialFillAccounting() public {
        (CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth, bytes memory makerAuthSig, CovenantSpotSettlement.SignedOrder memory makerOrder, bytes memory makerOrderSig, CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth, bytes memory takerAuthSig, CovenantSpotSettlement.SignedOrder memory takerOrder, bytes memory takerOrderSig, CovenantSpotSettlement.FillInstruction memory fill) = _buildTrade();

        fill.baseAmount = 0.5 ether;
        fill.quoteAmount = 1_500 ether;
        fill.fillNonce = keccak256("fill-1");

        bytes32 makerAuthHash = settlement.hashTradingSessionAuthorization(makerAuth);
bytes32 takerAuthHash = settlement.hashTradingSessionAuthorization(takerAuth);
        bytes32 makerOrderHash = settlement.hashSignedOrder(makerOrder);

        vm.prank(executor);
        settlement.settleSpotTrade(makerAuth, makerAuthSig, makerOrder, makerOrderSig, takerAuth, takerAuthSig, takerOrder, takerOrderSig, fill);


assertEq(settlement.usedBaseByAuth(makerAuthHash), 0.5 ether);
assertEq(settlement.usedQuoteByAuth(makerAuthHash), 0);

assertEq(settlement.usedBaseByAuth(takerAuthHash), 0);
assertEq(settlement.usedQuoteByAuth(takerAuthHash), 1500 ether);
        assertEq(settlement.filledBaseByOrder(makerOrderHash), 0.5 ether);
    }


function testCannotSettleExpiredAuth() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    vm.warp(makerAuth.validBefore + 1);

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testCannotSettleCancelledOrder() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    bytes32 makerOrderHash = settlement.hashSignedOrder(makerOrder);

    vm.prank(maker);
    registry.cancelOrder(makerOrderHash);

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testCannotReplayFillNonce() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    vm.prank(executor);
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testCannotExceedOrderAmount() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    fill.baseAmount = 2 ether;
    fill.quoteAmount = 6_000 ether;

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testCannotSettleOutsidePriceBand() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    fill.price = 4_000 ether;
    fill.quoteAmount = 4_000 ether;

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testOnlyTrustedExecutorCanSettle() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    address random = address(0xBAD);

    vm.prank(random);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testCannotExceedAuthQuoteExposure() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    takerAuth.maxQuoteExposure = 2_000 ether;
    bytes32 newTakerAuthHash = settlement.hashTradingSessionAuthorization(takerAuth);
    takerAuthSig = _sign(takerPk, newTakerAuthHash);

    takerOrder.sessionAuthHash = newTakerAuthHash;
    bytes32 newTakerOrderHash = settlement.hashSignedOrder(takerOrder);
    takerOrderSig = _sign(takerPk, newTakerOrderHash);

    fill.takerAuthHash = newTakerAuthHash;
    fill.takerOrderHash = newTakerOrderHash;

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

function testInsufficientFundsReverts() public {
    (
        CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth,
        bytes memory makerAuthSig,
        CovenantSpotSettlement.SignedOrder memory makerOrder,
        bytes memory makerOrderSig,
        CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth,
        bytes memory takerAuthSig,
        CovenantSpotSettlement.SignedOrder memory takerOrder,
        bytes memory takerOrderSig,
        CovenantSpotSettlement.FillInstruction memory fill
    ) = _buildTrade();

    vm.prank(taker);
    usdc.approve(address(settlement), 0);

    vm.prank(executor);
    vm.expectRevert();
    settlement.settleSpotTrade(
        makerAuth,
        makerAuthSig,
        makerOrder,
        makerOrderSig,
        takerAuth,
        takerAuthSig,
        takerOrder,
        takerOrderSig,
        fill
    );
}

    function _buildTrade() internal returns (CovenantSpotSettlement.TradingSessionAuthorization memory makerAuth, bytes memory makerAuthSig, CovenantSpotSettlement.SignedOrder memory makerOrder, bytes memory makerOrderSig, CovenantSpotSettlement.TradingSessionAuthorization memory takerAuth, bytes memory takerAuthSig, CovenantSpotSettlement.SignedOrder memory takerOrder, bytes memory takerOrderSig, CovenantSpotSettlement.FillInstruction memory fill) {
        uint64 nowTs = uint64(block.timestamp);
        makerAuth = CovenantSpotSettlement.TradingSessionAuthorization(maker, executor, address(settlement), address(weth), address(usdc), marketId, 2, 2 ether, 6_000 ether, 2_500 ether, 3_500 ether, nowTs - 1, nowTs + 1 days, keccak256("maker-auth"));
        takerAuth = CovenantSpotSettlement.TradingSessionAuthorization(taker, executor, address(settlement), address(weth), address(usdc), marketId, 1, 2 ether, 6_000 ether, 2_500 ether, 3_500 ether, nowTs - 1, nowTs + 1 days, keccak256("taker-auth"));

        bytes32 makerAuthHash = settlement.hashTradingSessionAuthorization(makerAuth);
        bytes32 takerAuthHash = settlement.hashTradingSessionAuthorization(takerAuth);
        makerAuthSig = _sign(makerPk, makerAuthHash);
        takerAuthSig = _sign(takerPk, takerAuthHash);

        makerOrder = CovenantSpotSettlement.SignedOrder(maker, marketId, 0, 1, 3_000 ether, 1 ether, 1, keccak256("maker-order"), makerAuthHash, nowTs - 1, nowTs + 1 days);
        takerOrder = CovenantSpotSettlement.SignedOrder(taker, marketId, 1, 1, 3_000 ether, 1 ether, 1, keccak256("taker-order"), takerAuthHash, nowTs - 1, nowTs + 1 days);

        bytes32 makerOrderHash = settlement.hashSignedOrder(makerOrder);
        bytes32 takerOrderHash = settlement.hashSignedOrder(takerOrder);
        makerOrderSig = _sign(makerPk, makerOrderHash);
        takerOrderSig = _sign(takerPk, takerOrderHash);

        fill = CovenantSpotSettlement.FillInstruction(makerOrderHash, takerOrderHash, makerAuthHash, takerAuthHash, 3_000 ether, 1 ether, 3_000 ether, keccak256("fill-0"));
    }

    function _sign(uint256 pk, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
