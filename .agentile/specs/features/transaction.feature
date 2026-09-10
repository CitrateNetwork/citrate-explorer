# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Transaction page — explain this tx
  As a visitor inspecting a Citrate transaction
  I want a plain-English explanation above the raw data, decoded actions, transfers, details, and diagnostics
  So that I can understand what a transaction did without reading raw calldata

  Background:
    Given a transaction page is opened at "#/tx/:id"
    And the page reads "GET /api/tx/[hash]"
    And the network is the Citrate testnet (chain 40204, native SALT)

  # ---------------------------------------------------------------------------
  # Plain-English summary above the raw data
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Transaction loads its core data
    Given I open a valid transaction hash
    When "GET /api/tx/[hash]" resolves
    Then I see the transaction summary header with the hash and status
    But today the page reads design sample data and is not yet wired to "GET /api/tx/[hash]"

  @backend-ready @P-2
  Scenario: Plain-English explanation appears above the raw details
    Given the transaction data has loaded
    When the explanation narrative is requested from the agent via "explainTransaction"
    Then a plain-English summary of what the transaction did is shown above the raw data
    And the summary cites the underlying fields it draws from

  @backend-ready @P-2
  Scenario: Explanation narrative shows a loading state then streams in
    Given the transaction data has loaded
    When the agent explanation is being generated
    Then a loading state is shown in the explanation area
    And the explanation streams in without blocking the raw details below

  @backend-ready @P-2
  Scenario: Explanation falls back gracefully when the agent is unavailable
    Given the transaction data has loaded
    When the agent explanation request fails
    Then the explanation area shows that the narrative is unavailable
    And the raw and decoded data remain fully visible

  # ---------------------------------------------------------------------------
  # Decoded action + token transfers
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Decoded action is shown for a recognised method
    Given the transaction calls a known method
    When the page decodes the calldata
    Then I see the decoded action with the method name and parameters
    And when the method cannot be decoded I see the raw method selector instead

  @backend-ready @P-1
  Scenario: Token transfers are listed when present
    Given the transaction produced token transfers
    When the page renders transfers
    Then I see each transfer with token, from, to, and amount
    But this depends on indexer token_transfers which is not yet populated

  @backend-ready @P-1
  Scenario: Token transfers section is empty when there are none
    Given the transaction produced no token transfers
    Then the transfers section shows an empty state rather than a fabricated row

  # ---------------------------------------------------------------------------
  # Details key-value block
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Details block shows the canonical transaction fields
    Given the transaction data has loaded
    Then the details block shows from, to, block, blue_score, nonce, gas, gas paid by, and timestamp
    And the timestamp is shown as an ISO date
    And value amounts are shown in SALT with grains where relevant

  @backend-ready @P-1 @gasless
  Scenario: Details block attributes the gas payer for a gasless transaction
    Given the transaction was relayed gaslessly via EIP-2771
    When the details block renders the gas paid by field
    Then it names the relayer or forwarder as the gas payer
    And it shows the original sender as the from address

  # ---------------------------------------------------------------------------
  # Tabs
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario Outline: Transaction tabs render their content
    Given the transaction data has loaded
    When I select the "<tab>" tab
    Then the "<tab>" content is shown

    Examples:
      | tab        |
      | overview   |
      | internal   |
      | logs       |
      | state-diff |
      | raw        |

  @backend-ready @P-1
  Scenario: Logs tab decodes event logs when an ABI is available
    Given the transaction emitted event logs
    When I open the logs tab
    Then known events are decoded to names and parameters
    And unknown events are shown with raw topics and data

  @backend-ready @P-1
  Scenario: State-diff tab shows balance and storage changes
    Given the transaction changed account state
    When I open the state-diff tab
    Then I see before and after values for affected accounts and storage slots

  @backend-ready @P-1
  Scenario: Raw tab shows the unmodified transaction payload
    Given the transaction data has loaded
    When I open the raw tab
    Then I see the raw transaction object exactly as returned by the node

  @backend-ready @P-1
  Scenario: Tabs with no data show empty states
    Given the transaction has no internal calls and no logs
    When I open the internal tab and then the logs tab
    Then each shows an empty state explaining there is nothing to display

  # ---------------------------------------------------------------------------
  # Error diagnosis + stuck/pending copilot
  # ---------------------------------------------------------------------------

  @backend-ready @P-2
  Scenario: Failed transaction shows a decoded revert and a suggestion
    Given the transaction reverted
    When the page diagnoses the failure
    Then I see the decoded revert reason
    And I see a plain-English suggestion for how to address it
    And when the revert reason cannot be decoded I see the raw revert data

  @backend-ready @P-2
  Scenario: Pending transaction shows a stuck-transaction copilot
    Given the transaction is still pending
    When the page renders the pending state
    Then I see a copilot explaining why it may be pending
    And I see guidance such as fee or nonce considerations on Citrate

  # ---------------------------------------------------------------------------
  # Finality badge
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Finality badge reflects depth against the finality threshold
    Given the transaction is included in a block
    When the page computes finality from depth against the threshold of 100
    Then the finality badge shows whether the transaction is final or still maturing
    And a maturing transaction shows its current depth toward 100

  # ---------------------------------------------------------------------------
  # Loading, not found, error, mobile, a11y
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Transaction page shows a loading skeleton
    Given I open a transaction page
    When "GET /api/tx/[hash]" has not resolved
    Then the page shows skeletons for the summary, details, and tabs

  @backend-ready @P-1
  Scenario: Unknown transaction hash shows a not-found state
    Given I open a hash that matches no transaction
    When "GET /api/tx/[hash]" returns no match
    Then the page shows a not-found state
    And it offers to search or to ask the agent about the hash

  @backend-ready @P-1
  Scenario: Transaction fetch error shows an error boundary
    Given I open a transaction page
    When "GET /api/tx/[hash]" returns an error
    Then an error boundary is shown with a retry affordance

  @backend-ready @P-1 @mobile
  Scenario: Transaction page is usable on a mobile viewport
    Given I am on a mobile viewport
    When the transaction page renders
    Then the summary, details, and tabs stack and remain readable
    And the tab strip is horizontally scrollable rather than clipped

  @backend-ready @P-1 @a11y
  Scenario: Transaction tabs are an accessible tablist
    Given the transaction page is rendered
    Then the tabs form a tablist with arrow-key navigation
    And the active tab and its panel are correctly associated for assistive technology
