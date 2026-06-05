// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

import "../src/CovenantAuthorizationRegistry.sol";
import "../src/CovenantSpotSettlement.sol";
import "../src/MockERC20.sol";
import "../src/CsdUsdcSettlement.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address executor = vm.envAddress("EXECUTOR");

        vm.startBroadcast(deployerPk);

        CovenantAuthorizationRegistry registry = new CovenantAuthorizationRegistry();
CsdUsdcSettlement csdUsdcSettlement = new CsdUsdcSettlement(address(registry));
        CovenantSpotSettlement settlement = new CovenantSpotSettlement(address(registry));

        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 18);

        registry.setTrustedExecutor(executor, true);
console2.log("CSD_USDC_SETTLEMENT=", address(csdUsdcSettlement));

        vm.stopBroadcast();

        console2.log("REGISTRY=", address(registry));
        console2.log("SETTLEMENT=", address(settlement));
        console2.log("WETH=", address(weth));
        console2.log("USDC=", address(usdc));
        console2.log("EXECUTOR=", executor);
    }
}
