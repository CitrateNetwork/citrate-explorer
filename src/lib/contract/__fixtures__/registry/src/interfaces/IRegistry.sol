// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

interface IRegistry {
    struct Entry {
        address owner;
        uint64 since;
        bytes32[] tags;
    }

    event Registered(bytes32 indexed node, string name, address indexed owner);

    function resolve(string calldata name) external view returns (address);
}
