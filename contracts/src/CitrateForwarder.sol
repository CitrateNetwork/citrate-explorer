// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @title CitrateForwarder
/// @notice EIP-2771 trusted forwarder for gasless meta-transactions on Citrate.
///         A user signs an EIP-712 `ForwardRequest` (no gas); the Foundation
///         relayer calls {execute}, paying gas. The forwarder verifies the
///         signature, enforces a per-signer nonce (replay protection) and a
///         deadline, then calls the target appending the original sender to the
///         calldata so an ERC-2771-aware target can recover it via `_msgSender()`.
/// @dev Security-sensitive (Rule 8): the deploy ceremony gates on external review
///      + the TLA+ replay/nonce spec. Mirrors the audited OpenZeppelin
///      ERC2771Forwarder design (nonce, deadline, gas-griefing guard).
contract CitrateForwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint48 deadline;
        bytes data;
    }

    bytes32 private constant _TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _HASHED_NAME = keccak256(bytes("CitrateForwarder"));
    bytes32 private constant _HASHED_VERSION = keccak256(bytes("1"));

    /// @notice Next expected nonce per signer.
    mapping(address => uint256) public nonces;

    event Forwarded(address indexed from, address indexed to, uint256 nonce, bool success);

    error InvalidSigner(address recovered, address from);
    error ExpiredRequest(uint48 deadline);
    error InvalidNonce(uint256 expected, uint256 provided);
    error MismatchedValue(uint256 supplied, uint256 expected);
    error InsufficientGas();
    error CallFailed(bytes returndata);

    /// @notice The EIP-712 domain separator for this forwarder on this chain.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(_DOMAIN_TYPEHASH, _HASHED_NAME, _HASHED_VERSION, block.chainid, address(this))
        );
    }

    function _digest(ForwardRequest calldata req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, req.deadline, keccak256(req.data)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice True iff `signature` is a valid, current, unexpired request from `req.from`.
    /// @dev A view call cannot observe the value that a later execute call will
    /// supply. `execute` enforces the outer-value equality at the payable
    /// boundary; the relay route separately rejects all nonzero requests.
    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        if (req.deadline < block.timestamp) return false;
        if (req.nonce != nonces[req.from]) return false;
        return _recover(_digest(req), signature) == req.from;
    }

    /// @notice Execute a signed meta-transaction. Reverts unless valid.
    /// @return success Whether the inner call succeeded.
    /// @return returndata The inner call's return data.
    function execute(ForwardRequest calldata req, bytes calldata signature)
        public
        payable
        returns (bool success, bytes memory returndata)
    {
        if (msg.value != req.value) revert MismatchedValue(msg.value, req.value);
        if (req.deadline < block.timestamp) revert ExpiredRequest(req.deadline);
        uint256 expected = nonces[req.from];
        if (req.nonce != expected) revert InvalidNonce(expected, req.nonce);

        address signer = _recover(_digest(req), signature);
        if (signer == address(0) || signer != req.from) revert InvalidSigner(signer, req.from);

        // Effects before interaction (replay protection).
        nonces[req.from] = expected + 1;

        // ERC-2771: append the original sender so the target's _msgSender() works.
        (success, returndata) = req.to.call{gas: req.gas, value: req.value}(
            abi.encodePacked(req.data, req.from)
        );

        // Gas-griefing guard: ensure the relayer actually supplied req.gas. If the
        // 1/64 retained gas is at-or-below req.gas/63, the call may have been
        // starved — invalidate so the relayer cannot grief the signer.
        if (gasleft() <= req.gas / 63) revert InsufficientGas();

        emit Forwarded(req.from, req.to, req.nonce, success);
        if (!success) revert CallFailed(returndata);
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        // Reject malleable high-s signatures (EIP-2).
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
