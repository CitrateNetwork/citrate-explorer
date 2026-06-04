// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CitratePulse} from "../src/CitratePulse.sol";

/// @notice Deploys CitratePulse — the per-block AI-economy heartbeat used to
///         generate steady, debuggable synthetic traffic on Citrate.
///
/// Run (with a FUNDED deployer key):
///   PULSE_KEEPER=0x...        # the bot EOA that drives pulses + receives tips
///   PULSE_TIP_WEI=...         # optional per-pulse gas reimbursement (e.g. 1e15 = 0.001 SALT)
///   PULSE_FUND_WEI=...        # optional SALT to seed the contract's tip treasury
///   DEPLOYER_PRIVATE_KEY=0x...
///   forge script contracts/script/DeployPulse.s.sol --rpc-url citrate --broadcast
///
/// Record the printed address into NEXT_PUBLIC and the beacon bot's PULSE_ADDRESS.
contract DeployPulse is Script {
    function run() external returns (CitratePulse pulse) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address keeper = vm.envAddress("PULSE_KEEPER");
        uint256 tip = vm.envOr("PULSE_TIP_WEI", uint256(0));
        uint256 fund = vm.envOr("PULSE_FUND_WEI", uint256(0));

        vm.startBroadcast(pk);
        pulse = new CitratePulse{value: fund}(keeper, tip);
        vm.stopBroadcast();

        console2.log("CitratePulse deployed:", address(pulse));
        console2.log("keeper:", keeper);
        console2.log("tipWei:", tip);
        console2.log("funded (wei):", fund);
    }
}
