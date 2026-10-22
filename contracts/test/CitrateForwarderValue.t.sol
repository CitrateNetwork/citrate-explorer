// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CitrateForwarder} from "../src/CitrateForwarder.sol";

/// Payable ERC-2771 target that records what it received.
contract ValueSink {
    uint256 public lastValue;
    uint256 public calls;

    function take() external payable {
        lastValue = msg.value;
        calls += 1;
    }
}

/// Call-value accounting for `CitrateForwarder.execute`.
///
/// Invariant under test: the native value a request forwards is always the value
/// the caller attached to `execute` — never the forwarder's own balance, and
/// never stranded in the forwarder. A rejected call consumes no nonce.
contract CitrateForwarderValueTest is Test {
    /// `MismatchedValue(uint256 supplied, uint256 expected)`. Spelled out so the
    /// suite compiles against a forwarder that predates the error.
    bytes4 internal constant MISMATCHED_VALUE = bytes4(keccak256("MismatchedValue(uint256,uint256)"));

    bytes32 internal constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    CitrateForwarder internal fwd;
    ValueSink internal sink;
    uint256 internal userPk = 0xB0B;
    address internal user;
    address internal relayer = address(0xBEEF);

    function setUp() public {
        fwd = new CitrateForwarder();
        sink = new ValueSink();
        user = vm.addr(userPk);
        vm.warp(1_000_000);
        vm.deal(relayer, 1_000 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _req(uint256 value, uint256 nonce, uint48 deadline)
        internal
        view
        returns (CitrateForwarder.ForwardRequest memory)
    {
        return CitrateForwarder.ForwardRequest({
            from: user,
            to: address(sink),
            value: value,
            gas: 100_000,
            nonce: nonce,
            deadline: deadline,
            data: abi.encodeWithSelector(ValueSink.take.selector)
        });
    }

    function _sign(CitrateForwarder.ForwardRequest memory req) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fwd.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _later() internal view returns (uint48) {
        return uint48(block.timestamp + 1 hours);
    }

    function _expectMismatch(uint256 supplied, uint256 expected) internal {
        vm.expectRevert(abi.encodeWithSelector(MISMATCHED_VALUE, supplied, expected));
    }

    /// The spelled-out selector above is the contract's own error.
    function testMismatchedValueSelectorMatchesContract() public pure {
        assertEq(CitrateForwarder.MismatchedValue.selector, MISMATCHED_VALUE);
    }

    // ------------------------------------------------------- value mismatches

    /// A funded forwarder must not pay a signed request out of its own balance
    /// when the caller attaches nothing.
    function testZeroCallValueCannotSpendForwarderBalance() public {
        vm.deal(address(fwd), 7 ether);
        CitrateForwarder.ForwardRequest memory req = _req(7 ether, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(0, 7 ether);
        vm.prank(relayer);
        fwd.execute{value: 0}(req, sig);

        assertEq(address(fwd).balance, 7 ether, "forwarder balance untouched");
        assertEq(address(sink).balance, 0, "target received nothing");
        assertEq(fwd.nonces(user), 0, "a rejected call consumes no nonce");
    }

    /// Under-paying: the caller attaches part of the value and the forwarder's
    /// balance would make up the difference.
    function testUnderpaidCallValueRejected() public {
        vm.deal(address(fwd), 5 ether);
        CitrateForwarder.ForwardRequest memory req = _req(6 ether, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(1 ether, 6 ether);
        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);

        assertEq(address(fwd).balance, 5 ether, "forwarder balance untouched");
        assertEq(relayer.balance, 1_000 ether, "relayer refunded by the revert");
    }

    /// Over-paying: the surplus would otherwise stay in the forwarder, where the
    /// next zero-value caller could spend it.
    function testOverpaidCallValueRejected() public {
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(3 ether, 1 ether);
        vm.prank(relayer);
        fwd.execute{value: 3 ether}(req, sig);

        assertEq(address(fwd).balance, 0, "no value stranded in the forwarder");
        assertEq(relayer.balance, 1_000 ether, "relayer refunded by the revert");
    }

    /// A zero-value request must not accept attached value either.
    function testValueAttachedToZeroValueRequestRejected() public {
        CitrateForwarder.ForwardRequest memory req = _req(0, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(1, 0);
        vm.prank(relayer);
        fwd.execute{value: 1}(req, sig);

        assertEq(address(fwd).balance, 0, "no value stranded in the forwarder");
    }

    /// Over-pay then drain, end to end: neither step may succeed.
    function testStrandThenSpendSequenceFails() public {
        CitrateForwarder.ForwardRequest memory first = _req(0, 0, _later());
        bytes memory sig1 = _sign(first);
        _expectMismatch(2 ether, 0);
        vm.prank(relayer);
        fwd.execute{value: 2 ether}(first, sig1);
        assertEq(address(fwd).balance, 0, "step one strands nothing");

        // Even if value reaches the forwarder another way (selfdestruct, genesis
        // allocation), a zero-value caller still cannot spend it.
        vm.deal(address(fwd), 2 ether);
        CitrateForwarder.ForwardRequest memory second = _req(2 ether, 0, _later());
        bytes memory sig2 = _sign(second);
        _expectMismatch(0, 2 ether);
        vm.prank(relayer);
        fwd.execute{value: 0}(second, sig2);
        assertEq(address(fwd).balance, 2 ether, "step two spends nothing");
    }

    /// Property: for every (attached, signed) pair that differs, execute reverts
    /// and moves no value.
    function testFuzzAnyMismatchReverts(uint96 attached, uint96 signed, uint96 preFund) public {
        vm.assume(attached != signed);
        vm.deal(address(fwd), preFund);
        vm.deal(relayer, attached);
        CitrateForwarder.ForwardRequest memory req = _req(signed, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(attached, signed);
        vm.prank(relayer);
        fwd.execute{value: attached}(req, sig);

        assertEq(address(fwd).balance, preFund, "forwarder balance unchanged");
        assertEq(address(sink).balance, 0, "target unchanged");
        assertEq(fwd.nonces(user), 0, "nonce unchanged");
    }

    // ------------------------------------------------------ positive controls

    function testZeroValueRequestWithZeroCallValueSucceeds() public {
        CitrateForwarder.ForwardRequest memory req = _req(0, 0, _later());
        bytes memory sig = _sign(req);

        vm.prank(relayer);
        (bool ok,) = fwd.execute{value: 0}(req, sig);

        assertTrue(ok, "inner call succeeded");
        assertEq(sink.calls(), 1, "target reached");
        assertEq(sink.lastValue(), 0, "no value forwarded");
        assertEq(fwd.nonces(user), 1, "nonce consumed");
    }

    function testMatchedValueForwardsExactlyAndLeavesForwarderBalance() public {
        vm.deal(address(fwd), 4 ether); // pre-existing balance must not move
        CitrateForwarder.ForwardRequest memory req = _req(2 ether, 0, _later());
        bytes memory sig = _sign(req);

        vm.prank(relayer);
        fwd.execute{value: 2 ether}(req, sig);

        assertEq(address(sink).balance, 2 ether, "target received the attached value");
        assertEq(sink.lastValue(), 2 ether, "msg.value seen by target");
        assertEq(address(fwd).balance, 4 ether, "forwarder balance unchanged");
        assertEq(relayer.balance, 998 ether, "relayer paid exactly the attached value");
    }

    /// A mismatch revert must not burn the signer's nonce: the same signed
    /// request still executes once the caller attaches the right value.
    function testMismatchDoesNotBurnNonce() public {
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, _later());
        bytes memory sig = _sign(req);

        _expectMismatch(0, 1 ether);
        vm.prank(relayer);
        fwd.execute{value: 0}(req, sig);

        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);
        assertEq(fwd.nonces(user), 1, "nonce consumed once");
        assertEq(address(sink).balance, 1 ether, "value delivered once");
    }

    // --------------------------------------------------- replay and deadline

    function testReplayedNonceRejectedWithMatchingValue() public {
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, _later());
        bytes memory sig = _sign(req);

        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);

        vm.expectRevert(abi.encodeWithSelector(CitrateForwarder.InvalidNonce.selector, 1, 0));
        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);

        assertEq(address(sink).balance, 1 ether, "value delivered exactly once");
        assertEq(address(fwd).balance, 0, "replay value not retained");
    }

    /// A replay with zero attached value against a funded forwarder must fail
    /// too, whichever check fires first.
    function testReplayedNonceWithZeroValueAgainstFundedForwarderRejected() public {
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, _later());
        bytes memory sig = _sign(req);
        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);

        vm.deal(address(fwd), 1 ether);
        vm.expectRevert();
        vm.prank(relayer);
        fwd.execute{value: 0}(req, sig);
        assertEq(address(fwd).balance, 1 ether, "forwarder balance untouched");
        assertEq(address(sink).balance, 1 ether, "no second delivery");
    }

    function testFutureNonceRejected() public {
        CitrateForwarder.ForwardRequest memory req = _req(0, 1, _later());
        bytes memory sig = _sign(req);

        vm.expectRevert(abi.encodeWithSelector(CitrateForwarder.InvalidNonce.selector, 0, 1));
        vm.prank(relayer);
        fwd.execute{value: 0}(req, sig);
    }

    function testExpiredDeadlineRejectedWithMatchingValue() public {
        uint48 deadline = uint48(block.timestamp + 10);
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, deadline);
        bytes memory sig = _sign(req);
        vm.warp(uint256(deadline) + 1);

        assertFalse(fwd.verify(req, sig), "verify reports the expired request");
        vm.expectRevert(abi.encodeWithSelector(CitrateForwarder.ExpiredRequest.selector, deadline));
        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);
        assertEq(fwd.nonces(user), 0, "nonce unchanged");
    }

    /// Expired and under-funded at once, against a funded forwarder: must revert
    /// and move nothing.
    function testExpiredDeadlineWithZeroValueAgainstFundedForwarderRejected() public {
        uint48 deadline = uint48(block.timestamp + 10);
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, deadline);
        bytes memory sig = _sign(req);
        vm.deal(address(fwd), 1 ether);
        vm.warp(uint256(deadline) + 1);

        vm.expectRevert();
        vm.prank(relayer);
        fwd.execute{value: 0}(req, sig);
        assertEq(address(fwd).balance, 1 ether, "forwarder balance untouched");
    }

    function testDeadlineEqualToNowIsStillValid() public {
        uint48 deadline = uint48(block.timestamp);
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, deadline);
        bytes memory sig = _sign(req);

        assertTrue(fwd.verify(req, sig), "deadline is inclusive");
        vm.prank(relayer);
        fwd.execute{value: 1 ether}(req, sig);
        assertEq(address(sink).balance, 1 ether, "delivered at the deadline");
    }

    /// Signed value is part of the digest: re-labelling the value invalidates
    /// the signature even when the attached value matches the new label.
    function testRelabelledValueBreaksSignature() public {
        CitrateForwarder.ForwardRequest memory req = _req(1 ether, 0, _later());
        bytes memory sig = _sign(req);
        req.value = 2 ether;

        vm.expectRevert();
        vm.prank(relayer);
        fwd.execute{value: 2 ether}(req, sig);
        assertEq(address(sink).balance, 0, "nothing delivered");
    }
}
