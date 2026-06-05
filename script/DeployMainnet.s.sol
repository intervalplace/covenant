// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

import "../src/CovenantAuthorizationRegistry.sol";
import "../src/CovenantSpotSettlement.sol";
import "../src/CsdUsdcSettlement.sol";

contract DeployMainnet is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address executor = vm.envAddress("EXECUTOR");

        vm.startBroadcast(deployerPk);

        CovenantAuthorizationRegistry registry =
            new CovenantAuthorizationRegistry();

        CovenantSpotSettlement settlement =
            new CovenantSpotSettlement(address(registry));

        CsdUsdcSettlement csdUsdcSettlement =
            new CsdUsdcSettlement(address(registry));

        registry.setTrustedExecutor(executor, true);

        vm.stopBroadcast();

console2.log("REGISTRY=", vm.toString(address(registry)));
 console2.log("SETTLEMENT=", vm.toString(address(settlement))); 
console2.log("CSD_USDC_SETTLEMENT=", vm.toString(address(csdUsdcSettlement))); 
console2.log("EXECUTOR=", vm.toString(executor));
    }
}
