/**
 * The curated standard signature set bundled into src/generated/signatures.json
 * (EXP-S3). Human-readable ABI items from published standards (ERC/EIP text) and
 * widely deployed OpenZeppelin interfaces, so unverified contracts that implement
 * them show readable selectors, events and errors with no runtime 4byte lookup.
 *
 * Add an entry only when its source is a published standard or a widely used
 * library interface; name the source in the group comment.
 */
export const STANDARD_SIGNATURES: readonly string[] = [
  // ERC-20 (EIP-20) + metadata
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  // OpenZeppelin ERC20 helpers
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)",
  // EIP-2612 permit
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  // EIP-5267
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  // WETH9 (wrapped native token)
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
  // ERC-721 (EIP-721) + metadata + enumerable
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  // ERC-1155 (EIP-1155)
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)",
  "function uri(uint256 id) view returns (string)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event URI(string value, uint256 indexed id)",
  // ERC-165
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  // ERC-4626 (subset)
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  // OpenZeppelin Ownable / Ownable2Step
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
  "function pendingOwner() view returns (address)",
  "function acceptOwnership()",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
  // OpenZeppelin AccessControl
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function renounceRole(bytes32 role, address callerConfirmation)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  // OpenZeppelin Pausable / ReentrancyGuard / Initializable
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "error EnforcedPause()",
  "error ExpectedPause()",
  "error ReentrancyGuardReentrantCall()",
  "event Initialized(uint64 version)",
  "event Initialized(uint8 version)",
  "error InvalidInitialization()",
  "error NotInitializing()",
  // ERC-6093 token errors
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
  "error ERC721InvalidOwner(address owner)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  // EIP-1967 / EIP-1822 / UUPS / transparent / beacon proxies
  "function implementation() view returns (address)",
  "function admin() view returns (address)",
  "function changeAdmin(address newAdmin)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function proxiableUUID() view returns (bytes32)",
  "function UPGRADE_INTERFACE_VERSION() view returns (string)",
  "event Upgraded(address indexed implementation)",
  "event AdminChanged(address previousAdmin, address newAdmin)",
  "event BeaconUpgraded(address indexed beacon)",
  "error ERC1967InvalidImplementation(address implementation)",
  "error UUPSUnauthorizedCallContext()",
  "error UUPSUnsupportedProxiableUUID(bytes32 slot)",
  // ERC-2771 trusted forwarder
  "function isTrustedForwarder(address forwarder) view returns (bool)",
  "function trustedForwarder() view returns (address)",
  // Multicall (OpenZeppelin Multicall, Multicall3)
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  // ERC-4337 EntryPoint (v0.7 subset)
  "function depositTo(address account) payable",
  "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
  "function withdrawTo(address withdrawAddress, uint256 withdrawAmount)",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  // Gnosis Safe (subset)
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
];
