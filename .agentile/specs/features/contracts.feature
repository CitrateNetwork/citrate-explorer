# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@wagmi @P-4
Feature: Smart contract read, write, gasless relay, events, and verification
  As a developer using CitrateScan
  I want to read and write verified contracts through wagmi and viem on chain 40204
  So that I can interact with the Citrate Network directly from the explorer, including gas-free writes via the EIP-2771 relayer.

  Today the contract page reads design sample data, Contract Read is simulated, Contract
  Write is a fake modal with no EIP-712 signature and no relay, the CitrateForwarder contract
  and src/lib/citrate/abi.ts do not exist, and POST /api/relay and POST /api/verify are stubs.
  This feature specifies the real wagmi/viem behaviour these screens must implement.

  Background:
    Given the viem chain is defined for Citrate at id 40204 with native SALT at 18 decimals
    And the wagmi config via @privy-io/wagmi exposes an http transport to rpc.citrate.ai and a ws transport
    And the <Providers> tree is mounted so wagmi and viem hooks are live

  # ===================== READ TAB =====================

  @todo
  Scenario: Decoded read of a verified contract via useReadContract
    Given I am on the contract page "#/contract/:addr" for a verified contract
    And the contract has a stored, verified ABI
    When I open the "Read" tab
    Then each read-only function is listed with its inputs and outputs decoded from the ABI
    When I call a no-argument view function
    Then useReadContract performs an eth_call over the public client
    And the decoded return value is rendered with its Solidity type

  @todo
  Scenario: Read a function that takes arguments
    Given I am on the Read tab of a verified contract
    When I enter an address argument and invoke a view function
    Then the argument is encoded per the ABI and an eth_call is made
    And the decoded result is displayed
    And entity values such as addresses render as clickable chips

  @todo @error
  Scenario: Read against an unverified contract has no ABI
    Given I am on the contract page for an unverified contract
    And "GET /api/contract/:addr" reports verified:false with bytecode only
    When I open the "Read" tab
    Then I am told the contract is not verified and no decoded ABI is available
    And I am offered a link to verify the contract

  @todo @error
  Scenario: Read reverts on the node
    Given I am on the Read tab of a verified contract
    When I call a view function whose eth_call reverts
    Then the revert reason is surfaced honestly
    And the failure is not masked as an empty success

  @todo
  Scenario: Read while the RPC is unreachable
    Given the RPC at rpc.citrate.ai is down
    When I attempt a contract read
    Then I see an honest "network unavailable" state
    And no sample fallback value is presented as a real result

  # ===================== WRITE TAB (wallet pays) =====================

  @todo @wagmi
  Scenario: Write to a contract using the connected wallet
    Given I am signed in and useAccount reports a connected wallet on chain 40204
    And I am on the "Write" tab of a verified contract
    When I fill a state-changing function's inputs and submit
    Then useWriteContract sends the transaction from my account
    And I am shown the pending transaction hash linking to "#/tx/:id"
    And on confirmation the receipt status and gas used in SALT are displayed

  @todo @wagmi @auth
  Scenario: Write tab requires a connected wallet
    Given I am logged out or no wallet is connected
    When I open the "Write" tab
    Then the write controls prompt me to sign in and connect
    And no transaction is built until useAccount is connected

  @todo @wagmi @error
  Scenario: Wallet write is rejected in the wallet
    Given I am connected and have prepared a write
    When I submit and reject the request in my wallet
    Then I see a non-blocking "transaction rejected" message
    And no hash is recorded

  @todo @wagmi @error
  Scenario: Wrong network on write
    Given my wallet is connected to a chain other than 40204
    When I attempt a write
    Then I am prompted to switch to the Citrate network before the transaction is sent

  @todo @wagmi @error
  Scenario: Write fails for insufficient SALT
    Given I am connected on chain 40204 with insufficient SALT for gas
    When I submit a wallet-paid write
    Then the failure clearly states the wallet has insufficient SALT
    And gasless relay is offered as an alternative

  # ===================== GASLESS WRITE (EIP-2771) =====================

  @todo @wagmi @gasless
  Scenario: Gasless write via EIP-712 ForwardRequest relayed by CitrateForwarder
    Given I am signed in with a connected account on chain 40204
    And the CitrateForwarder contract is deployed and its address and ABI are available in src/lib/citrate/abi.ts
    And I have chosen "gasless" on the Write tab
    When I submit a state-changing call
    Then the client builds an EIP-712 ForwardRequest with from, to, value, gas, nonce, and data
    And useSignTypedData prompts me to sign the typed data with no gas cost
    And the signed request is sent to "POST /api/relay"
    And the relayer submits via CitrateForwarder, which pays the gas in SALT
    And I receive the resulting transaction hash linking to "#/tx/:id"

  @todo @gasless @security
  Scenario: Relay verifies the ForwardRequest signature and nonce
    Given a signed ForwardRequest is posted to "POST /api/relay"
    When the relayer processes it
    Then the EIP-712 signature is verified against the request's from address
    And the forwarder nonce for that signer is checked to prevent replay
    And only a valid, current request is forwarded on-chain

  @todo @gasless @error
  Scenario: Relay is unavailable today
    Given the CitrateForwarder is not yet deployed
    When the client posts a ForwardRequest to "POST /api/relay"
    Then the endpoint responds 503 or 501
    And the UI explains that gasless relay is not yet available and offers the wallet-paid path

  @todo @gasless @error
  Scenario: Relay rejects a replayed or stale request
    Given a ForwardRequest with a nonce that has already been used
    When it is posted to "POST /api/relay"
    Then the relayer rejects it as a replay
    And no duplicate transaction is broadcast

  @todo @gasless @error
  Scenario: Visitor declines to sign the typed data
    Given I have chosen the gasless path
    When the useSignTypedData prompt appears and I decline
    Then no request is posted to "POST /api/relay"
    And I remain on the Write tab with my inputs intact

  # ===================== EVENT WATCHING =====================

  @todo @wagmi
  Scenario: Live event watching via useWatchContractEvent
    Given I am on a verified contract page
    And the contract emits events defined in its ABI
    When I open the "Events" view
    Then useWatchContractEvent subscribes over the ws transport
    And newly emitted events stream in with decoded args and clickable entity chips

  @todo @wagmi @error
  Scenario: Event subscription falls back when the websocket drops
    Given event watching is active over the ws transport
    When the websocket connection drops
    Then I see an honest "live updates paused" indicator
    And the view recovers when the connection is restored

  # ===================== VERIFICATION =====================

  @todo @security
  Scenario: Submit standard JSON input for verification
    Given I am on a contract page for an unverified contract
    When I open the verification form and submit standard-JSON-input source, compiler version, and optimization settings
    Then the submission is sent to "POST /api/verify"
    And I receive a verification guid to poll

  @todo @security
  Scenario: Submit flattened source for verification
    Given I am verifying an unverified contract
    When I submit a single flattened source file with the contract name and compiler version
    Then the submission is accepted at "POST /api/verify" and returns a guid

  @todo @security
  Scenario: Poll verification status to completion
    Given I have a verification guid
    When I poll "GET /api/verify/:guid"
    Then I see "pending", then a terminal "verified" or "failed" status
    And on success the contract page now reports verified:true and exposes the ABI to the Read and Write tabs

  @todo @security @error
  Scenario: Verification fails on bytecode mismatch
    Given I submitted source that does not match the deployed bytecode
    When I poll "GET /api/verify/:guid"
    Then the status is "failed" with a clear mismatch reason
    And the contract remains unverified

  @todo @error
  Scenario: Verification endpoint is a stub today
    Given the verification engine is not yet implemented
    When I submit to "POST /api/verify"
    Then the response indicates verification is not yet persisted
    And the UI is honest that verification is coming in this sprint rather than faking success

  @todo @a11y
  Scenario: Contract interaction tabs are keyboard accessible
    Given I am on a contract page
    When I navigate the Read, Write, and Events tabs with the keyboard
    Then each tab is a semantic control with a visible focus ring
    And each function form is reachable and submittable without a mouse
