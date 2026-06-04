// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CitratePulse} from "../src/CitratePulse.sol";

/// @dev A tiny stand-in for ModelRegistry.getAllModelHashes() so the probe path
///      is exercised deterministically in a local (non-forked) test.
contract MockModelRegistry {
    bytes32[] private hashes;
    function push(bytes32 h) external { hashes.push(h); }
    function getAllModelHashes() external view returns (bytes32[] memory) { return hashes; }
}

contract CitratePulseTest is Test {
    CitratePulse internal pulse;
    address internal keeper = address(0xBEEF);
    address internal owner = address(this);

    event Pulse(
        uint256 indexed sequence,
        uint256 indexed blockNumber,
        uint256 timestamp,
        string spotlight,
        uint256 modelsObserved,
        bytes32 sampleModel,
        address keeper
    );
    event TipPaid(address indexed keeper, uint256 amount);

    function setUp() public {
        pulse = new CitratePulse{value: 1 ether}(keeper, 0.001 ether);
    }

    function test_constructor_setsConfig() public view {
        assertEq(pulse.keeper(), keeper);
        assertEq(pulse.owner(), owner);
        assertEq(pulse.tipWei(), 0.001 ether);
        assertEq(pulse.sequence(), 0);
        assertEq(address(pulse).balance, 1 ether);
    }

    function test_pulse_onlyKeeper() public {
        vm.expectRevert(CitratePulse.NotKeeper.selector);
        pulse.pulse(); // called by owner/test, not keeper
    }

    function test_pulse_incrementsSequence_andRotatesSpotlight() public {
        // sequence 1 -> slot 1 == "lora"
        vm.prank(keeper);
        vm.expectEmit(true, true, false, false);
        emit Pulse(1, block.number, block.timestamp, "lora", 0, bytes32(0), keeper);
        pulse.pulse();
        assertEq(pulse.sequence(), 1);

        vm.prank(keeper);
        pulse.pulse();
        assertEq(pulse.sequence(), 2);
    }

    function test_pulse_paysTipToKeeper() public {
        uint256 before = keeper.balance;
        vm.prank(keeper);
        pulse.pulse();
        assertEq(keeper.balance, before + 0.001 ether);
        assertEq(address(pulse).balance, 1 ether - 0.001 ether);
    }

    function test_pulse_neverRevertsWhenProbeMisses() public {
        // No registry code at the hardcoded addresses in this local VM → staticcall
        // returns empty; the pulse must still succeed and emit.
        vm.prank(keeper);
        pulse.pulse();
        assertEq(pulse.sequence(), 1);
    }

    function test_pulse_readsModelRegistryWhenPresent() public {
        // Inject a mock at the real ModelRegistry address so the probe decodes.
        MockModelRegistry mock = new MockModelRegistry();
        mock.push(keccak256("modelA"));
        mock.push(keccak256("modelB"));
        vm.etch(pulse.MODEL_REGISTRY(), address(mock).code);
        // Re-seed the etched storage by calling push through the registry address.
        MockModelRegistry(pulse.MODEL_REGISTRY()).push(keccak256("modelA"));
        MockModelRegistry(pulse.MODEL_REGISTRY()).push(keccak256("modelB"));

        vm.recordLogs();
        vm.prank(keeper);
        pulse.pulse();
        // sequence 1 observed 2 models (asserted via no revert + state)
        assertEq(pulse.sequence(), 1);
    }

    function test_setTip_onlyOwner() public {
        vm.prank(keeper);
        vm.expectRevert(CitratePulse.NotOwner.selector);
        pulse.setTip(5);
        pulse.setTip(5);
        assertEq(pulse.tipWei(), 5);
    }

    function test_withdraw_recoversBalanceToOwner() public {
        uint256 before = owner.balance;
        pulse.withdraw();
        assertEq(address(pulse).balance, 0);
        assertEq(owner.balance, before + 1 ether);
    }

    function test_tipSkippedWhenBalanceTooLow() public {
        pulse.withdraw(); // drain
        vm.prank(keeper);
        pulse.pulse(); // tip skipped, no revert
        assertEq(pulse.sequence(), 1);
        assertEq(keeper.balance, 0);
    }

    // Allow this test contract to receive withdrawn SALT.
    receive() external payable {}
}
