// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import {IRegistry} from "./interfaces/IRegistry.sol";
import {Owned} from "./lib/Owned.sol";

/// @title Registry
/// @notice Test fixture for the contract pages: payable writes, custom errors,
/// struct and array inputs, and events. Compiled by scripts/contract/build-fixture.mjs.
contract Registry is IRegistry, Owned {
    uint256 public fee;
    mapping(bytes32 => Entry) private entries;

    error NameTaken(bytes32 node);
    error FeeRequired(uint256 required, uint256 sent);

    constructor(address initialOwner, uint256 initialFee) Owned(initialOwner) {
        fee = initialFee;
    }

    function register(string calldata name) external payable {
        if (msg.value < fee) revert FeeRequired(fee, msg.value);
        bytes32 node = keccak256(bytes(name));
        if (entries[node].owner != address(0)) revert NameTaken(node);
        entries[node].owner = msg.sender;
        entries[node].since = uint64(block.number);
        emit Registered(node, name, msg.sender);
    }

    function resolve(string calldata name) external view returns (address) {
        return entries[keccak256(bytes(name))].owner;
    }

    function entryOf(bytes32 node) external view returns (Entry memory) {
        return entries[node];
    }

    function tag(bytes32 node, bytes32[] calldata tags) external {
        require(entries[node].owner == msg.sender, "Registry: not the owner");
        for (uint256 i = 0; i < tags.length; i++) entries[node].tags.push(tags[i]);
    }

    function importEntries(bytes32[] calldata nodes, Entry[] calldata batch) external onlyOwner {
        for (uint256 i = 0; i < batch.length; i++) entries[nodes[i]] = batch[i];
    }

    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }
}
