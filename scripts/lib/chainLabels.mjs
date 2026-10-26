/**
 * The only hand-written part of the generated 40204 chain constants: what each precompile does and
 * what each genesis account is for. Addresses never live here; they come from citrate-chain.
 * `pnpm sync-addresses` fails when the chain adds a precompile or genesis account that has no entry,
 * so a new one cannot ship unlabeled.
 */

/** Catalog description per precompile name (book name, else the chain constant in PascalCase). */
export const PRECOMPILE_DESCRIPTIONS = {
  ModelDeploy: "Precompile: deploy a model to the inference runtime (needs a node hosting model weights).",
  ModelInference: "Precompile: run inference on a deployed model (inference runtime).",
  BatchInference: "Precompile: run a batch of inference requests (inference runtime).",
  ModelMetadata: "Precompile: read a deployed model's metadata (inference runtime).",
  ModelBenchmark: "Precompile: benchmark a deployed model (inference runtime).",
  ModelEncryption: "Precompile: model encryption helpers (inference runtime).",
  TensorCommit: "Precompile: commit to a tensor (hash commitment used by inference proofs).",
  InferenceProofVerify: "Precompile: verify an inference result proof.",
  MerkleVerifyTensor: "Precompile: verify a Merkle proof over tensor data.",
  FoldCommdVerify: "Precompile: verify a recursive-fold CommD storage proof (feature-gated activation).",
  TensorMatmulQ16: "Precompile: deterministic Q16 fixed-point matrix multiply.",
  TensorDotQ16: "Precompile: deterministic Q16 fixed-point dot product.",
  TensorSoftmaxQ16: "Precompile: deterministic Q16 fixed-point softmax.",
  TensorReluQ16: "Precompile: deterministic Q16 fixed-point ReLU.",
  TensorLinearQ16: "Precompile: deterministic Q16 fixed-point linear layer.",
  TensorTransposeQ16: "Precompile: deterministic Q16 fixed-point transpose.",
  BelnapAggregate: "Precompile: Belnap four-valued aggregation for federated learning rounds.",
  RoutingInference: "Precompile: routing-model inference (picks a route for a request).",
  LoraApply: "Agent precompile: apply a LoRA adapter, W + (alpha / r)(B . A), on one Q16.16 tile.",
  LoraMerge: "Agent precompile: weighted merge of LoRA adapters on one Q16.16 tile (federated-learning aggregate checks).",
  Ed25519Verify: "Precompile: Ed25519 signature verification.",
  MemoryAnchorVerify: "Agent precompile: verify a nightly memory-anchor inclusion proof against its day commitment.",
  AgentOps: "Agent precompile: DeviceLink and DeviceRevocation signature checks (agent device binding).",
  X402Eip712Verify: "Precompile: verify an x402 EIP-712 payment signature.",
  X402TransferAuthVerify: "Precompile: verify an x402 transfer authorization.",
  X402BatchPaymentVerify: "Precompile: verify a batch of x402 payments.",
};

/** Label per genesis account constant in citrate-chain `GenesisConfig::testnet_beta`. */
export const GENESIS_LABELS = {
  TESTNET_TREASURY_ADDRESS: "Genesis treasury",
  TESTNET_FAUCET_ADDRESS: "Reserve",
  TESTNET_DEPLOYER_ADDRESS: "Deployer",
  TESTNET_TEAM_ADDRESS: "Team / dev",
  TESTNET_VALIDATOR_ADDRESS: "Validator coinbase",
  FAUCET_SIGNER_ADDRESS: "Testnet faucet",
  VALIDATOR_STAKER_1_ADDRESS: "Validator staker 1",
  VALIDATOR_STAKER_2_ADDRESS: "Validator staker 2",
  VALIDATOR_STAKER_3_ADDRESS: "Validator staker 3",
  VALIDATOR_STAKER_4_ADDRESS: "Validator staker 4",
};
