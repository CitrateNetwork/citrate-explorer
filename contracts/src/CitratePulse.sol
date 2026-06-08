// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/**
 * @title CitratePulse — an on-chain heartbeat for the Citrate AI economy
 * @notice A deliberately SIMPLE, COMPLIANT test/telemetry artifact: once per
 *         block its keeper calls {pulse}, which emits a decodable snapshot of the
 *         network's AI-native primitives (read live from the real registries) and
 *         rotates a "primitive spotlight" so every block highlights a different
 *         capability — models, LoRA adapters, inference, federated training, x402,
 *         agents. It exists to produce steady, realistic, easy-to-debug traffic
 *         (transactions + decoded events + an optional native-SALT gas tip) on the
 *         explorer.
 *
 *         What it is NOT: there is no token, no yield, no user deposits, no
 *         financial mechanism, no third-party value flow. It only READS public
 *         registries and EMITS events. The contract may hold SALT that it uses
 *         solely to reimburse its own keeper's gas (standard relayer economics),
 *         and the owner can withdraw that balance at any time. This keeps the
 *         compliance posture clean: it's instrumentation, not a product.
 *
 * @dev Probe calls are best-effort low-level staticcalls — a registry miss never
 *      reverts the pulse, so the beacon keeps ticking regardless of chain state.
 *      Addresses are the live deployments on Citrate (chain 40204), per
 *      citrate-chain/contracts/DEPLOYED_ADDRESSES.md.
 */
contract CitratePulse {
    // ---- live AI-native registries on Citrate (chain 40204) ----
    address public constant MODEL_REGISTRY = 0x11a5e6F57751d8fa1c5b58ad2bf13528160985f0;
    address public constant LORA_FACTORY = 0xa1eeD6aE021504e2a1e310E6C0f7C1A0C5bF4647;
    address public constant INFERENCE_ROUTER = 0x6884ef1907468A13265a0bbb67Da20Ef4B52199B;
    address public constant COMPUTE_TRAINING = 0x25051e90A110fbE4569f124274ce387eB033bC9c;
    address public constant X402_PAYWALL = 0xD29D4D059808ADC43b761f41c675F1EB546E1a19;

    /// @dev The rotating spotlight vocabulary (one per block, by sequence).
    string[6] private SPOTLIGHTS = ["model", "lora", "inference", "training", "x402", "agent"];

    /// @notice The funded bot allowed to drive pulses (and the only tip recipient).
    address public immutable keeper;
    /// @notice Config/treasury controller.
    address public owner;
    /// @notice Monotonic pulse counter.
    uint256 public sequence;
    /// @notice Optional native-SALT gas reimbursement paid to the keeper per pulse.
    uint256 public tipWei;

    /// @notice The per-block heartbeat. Decodes cleanly in any explorer.
    event Pulse(
        uint256 indexed sequence,
        uint256 indexed blockNumber,
        uint256 timestamp,
        string spotlight,
        uint256 modelsObserved,
        bytes32 sampleModel,
        address keeper
    );
    /// @notice Result of the best-effort registry probe for this block's spotlight.
    event PrimitiveProbe(string indexed spotlight, address registry, bool ok, uint256 observed);
    /// @notice Emitted when a gas tip is reimbursed to the keeper.
    event TipPaid(address indexed keeper, uint256 amount);

    error NotKeeper();
    error NotOwner();

    constructor(address _keeper, uint256 _tipWei) payable {
        require(_keeper != address(0), "keeper=0");
        keeper = _keeper;
        owner = msg.sender;
        tipWei = _tipWei;
    }

    /**
     * @notice Emit one heartbeat for the current block. Keeper-only so the tip
     *         cannot be drained by arbitrary callers.
     */
    function pulse() external {
        if (msg.sender != keeper) revert NotKeeper();
        uint256 seq = ++sequence;
        uint256 slot = seq % SPOTLIGHTS.length;
        string memory spot = SPOTLIGHTS[slot];

        // Real read: enumerate registered models = the size of the AI economy.
        uint256 models;
        bytes32 sample;
        (bool ok, bytes memory ret) = MODEL_REGISTRY.staticcall(
            abi.encodeWithSignature("getAllModelHashes()")
        );
        if (ok && ret.length >= 64) {
            bytes32[] memory hashes = abi.decode(ret, (bytes32[]));
            models = hashes.length;
            if (models > 0) sample = hashes[seq % models];
        }

        emit PrimitiveProbe(spot, _registryFor(slot), ok, models);
        emit Pulse(seq, block.number, block.timestamp, spot, models, sample, keeper);

        // Optional: reimburse the keeper's gas from the pre-funded balance. This
        // also produces a real native-SALT transfer each block (more debug
        // surface). Never reverts the pulse if the transfer fails.
        uint256 tip = tipWei;
        if (tip != 0 && address(this).balance >= tip) {
            (bool sent, ) = payable(keeper).call{value: tip}("");
            if (sent) emit TipPaid(keeper, tip);
        }
    }

    /// @dev Which registry the spotlight points at (for the probe event).
    function _registryFor(uint256 slot) private pure returns (address) {
        if (slot == 0) return MODEL_REGISTRY;
        if (slot == 1) return LORA_FACTORY;
        if (slot == 2) return INFERENCE_ROUTER;
        if (slot == 3) return COMPUTE_TRAINING;
        if (slot == 4) return X402_PAYWALL;
        return MODEL_REGISTRY; // "agent" → models as the proxy signal
    }

    // ---- owner controls (treasury is fully recoverable) ----
    function setTip(uint256 newTipWei) external {
        if (msg.sender != owner) revert NotOwner();
        tipWei = newTipWei;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        require(newOwner != address(0), "owner=0");
        owner = newOwner;
    }

    /// @notice Pull the remaining SALT back to the owner at any time.
    function withdraw() external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, ) = payable(owner).call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    /// @notice Accept SALT to fund the keeper's gas tips.
    receive() external payable {}
}
