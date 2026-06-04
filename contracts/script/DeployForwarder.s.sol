// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {CitrateForwarder} from "../src/CitrateForwarder.sol";

/// @notice Deploys the CitrateForwarder. Run in the gasless deploy ceremony:
///   forge script contracts/script/DeployForwarder.s.sol --rpc-url citrate --broadcast
/// with DEPLOYER_PRIVATE_KEY set (a funded deployer). Record the address into
/// NEXT_PUBLIC_FORWARDER_ADDRESS. See the P-4 deploy-ceremony handoff.
contract DeployForwarder is Script {
    function run() external returns (CitrateForwarder forwarder) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        forwarder = new CitrateForwarder();
        vm.stopBroadcast();
    }
}
