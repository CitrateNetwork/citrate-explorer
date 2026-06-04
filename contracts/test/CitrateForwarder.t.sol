// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CitrateForwarder} from "../src/CitrateForwarder.sol";

/// ERC-2771-aware target: recovers the original sender from the appended calldata.
contract Recipient {
    address public lastSender;
    uint256 public lastValue;
    uint256 public count;

    error Boom();

    function ping() external payable returns (uint256) {
        lastSender = _msgSender();
        lastValue = msg.value;
        return ++count;
    }

    function boom() external pure {
        revert Boom();
    }

    function _msgSender() internal view returns (address s) {
        if (msg.data.length >= 20) {
            assembly {
                s := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            s = msg.sender;
        }
    }
}

contract CitrateForwarderTest is Test {
    CitrateForwarder internal fwd;
    Recipient internal rec;
    uint256 internal userPk = 0xA11CE;
    address internal user;

    bytes32 constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    function setUp() public {
        fwd = new CitrateForwarder();
        rec = new Recipient();
        user = vm.addr(userPk);
        vm.warp(1_000_000);
    }

    function _req(bytes memory data, uint256 nonce, uint48 deadline, uint256 value)
        internal
        view
        returns (CitrateForwarder.ForwardRequest memory)
    {
        return CitrateForwarder.ForwardRequest({
            from: user,
            to: address(rec),
            value: value,
            gas: 200_000,
            nonce: nonce,
            deadline: deadline,
            data: data
        });
    }

    function _sign(CitrateForwarder.ForwardRequest memory req, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fwd.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function testVerifyAndExecute() public {
        CitrateForwarder.ForwardRequest memory req =
            _req(abi.encodeWithSignature("ping()"), 0, uint48(block.timestamp + 1 hours), 0);
        bytes memory sig = _sign(req, userPk);

        assertTrue(fwd.verify(req, sig), "verify");
        fwd.execute(req, sig);

        assertEq(rec.lastSender(), user, "msgSender is the signer, not the relayer");
        assertEq(rec.count(), 1, "called once");
        assertEq(fwd.nonces(user), 1, "nonce advanced");
    }

    function testReplayReverts() public {
        CitrateForwarder.ForwardRequest memory req =
            _req(abi.encodeWithSignature("ping()"), 0, uint48(block.timestamp + 1 hours), 0);
        bytes memory sig = _sign(req, userPk);
        fwd.execute(req, sig);

        vm.expectRevert(abi.encodeWithSelector(CitrateForwarder.InvalidNonce.selector, 1, 0));
        fwd.execute(req, sig);
    }

    function testExpiredReverts() public {
        uint48 past = uint48(block.timestamp - 1);
        CitrateForwarder.ForwardRequest memory req = _req(abi.encodeWithSignature("ping()"), 0, past, 0);
        bytes memory sig = _sign(req, userPk);

        assertFalse(fwd.verify(req, sig), "expired not verifiable");
        vm.expectRevert(abi.encodeWithSelector(CitrateForwarder.ExpiredRequest.selector, past));
        fwd.execute(req, sig);
    }

    function testWrongSignerReverts() public {
        CitrateForwarder.ForwardRequest memory req =
            _req(abi.encodeWithSignature("ping()"), 0, uint48(block.timestamp + 1 hours), 0);
        bytes memory sig = _sign(req, 0xB0B); // not the `from`

        assertFalse(fwd.verify(req, sig), "wrong signer not verifiable");
        vm.expectRevert();
        fwd.execute(req, sig);
    }

    function testValueForwarded() public {
        uint256 value = 1 ether;
        CitrateForwarder.ForwardRequest memory req =
            _req(abi.encodeWithSignature("ping()"), 0, uint48(block.timestamp + 1 hours), value);
        bytes memory sig = _sign(req, userPk);

        fwd.execute{value: value}(req, sig);
        assertEq(rec.lastValue(), value, "value forwarded to target");
    }

    function testInnerRevertBubbles() public {
        CitrateForwarder.ForwardRequest memory req =
            _req(abi.encodeWithSignature("boom()"), 0, uint48(block.timestamp + 1 hours), 0);
        bytes memory sig = _sign(req, userPk);

        vm.expectRevert();
        fwd.execute(req, sig);
        // nonce must still have advanced (replay protection holds even on inner failure path)
        // is reverted with the whole tx, so nonce is rolled back — re-signing nonce 0 works:
        assertEq(fwd.nonces(user), 0, "tx reverted, nonce rolled back");
    }
}
