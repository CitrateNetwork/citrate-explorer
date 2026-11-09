// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @notice Linked (external) library used by FixtureCounter.
library FixtureMath {
    function twice(uint256 x) external pure returns (uint256) {
        return x * 2;
    }
}

/// @notice Verification fixture: immutables, constructor args and a linked library.
contract FixtureCounter {
    uint256 public immutable start;
    address public immutable deployer;
    string public label;
    uint256 public count;

    event Bumped(uint256 count);

    constructor(uint256 start_, string memory label_) {
        start = start_;
        deployer = msg.sender;
        label = label_;
    }

    function bump() external {
        count = FixtureMath.twice(count) + start;
        emit Bumped(count);
    }
}

/// @notice Verification fixture with no constructor args (deployed twice for similar matches).
contract FixturePlain {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }
}
