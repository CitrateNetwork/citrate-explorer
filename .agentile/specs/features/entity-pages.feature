# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Entity pages — block, address, token
  As a visitor inspecting Citrate entities
  I want dedicated block, address, and token pages with the right fields and tabs
  So that I can examine GHOSTDAG blocks, accounts, and tokens on the Citrate testnet

  Background:
    Given the network is the Citrate testnet (chain 40204, native SALT)
    And block and address pages read "GET /api/blocks/[id]" and "GET /api/address/[addr]"

  # ===========================================================================
  # Block page  (#/block/:id)
  # ===========================================================================

  @backend-ready @P-1
  Scenario: Block page loads its core data
    Given I open a block page at "#/block/:id"
    When "GET /api/blocks/[id]" resolves
    Then I see the block header with height and hash
    But today the page reads design sample data and is not yet wired to "GET /api/blocks/[id]"

  @backend-ready @P-1
  Scenario: Block page shows GHOSTDAG fields
    Given the block data has loaded
    Then I see the block height and blue_score
    And I see the selected parent distinguished from the merge parents
    And I see the validator that produced the block
    And I see the block timestamp as an ISO date

  @backend-ready @P-1
  Scenario: Block page shows a finality badge by depth
    Given the block data has loaded
    When finality is computed from depth against the threshold of 100
    Then the finality badge shows whether the block is final or still maturing
    And a maturing block shows its depth toward 100

  @backend-ready @P-1
  Scenario: Block parents link to their block pages
    Given the block data has loaded
    Then the selected parent links to its block page
    And each merge parent links to its block page

  @backend-ready @P-1
  Scenario: Block page lists the transactions in the block
    Given the block contains transactions
    Then I see the transactions in the block, each linking to "#/tx/:id"
    And when the block contains no transactions I see an empty state

  @backend-ready @P-1
  Scenario: Block page shows a loading skeleton
    Given I open a block page
    When "GET /api/blocks/[id]" has not resolved
    Then the page shows skeletons for the header, parents, and transactions

  @backend-ready @P-1
  Scenario: Unknown block shows a not-found state
    Given I open a block id that matches no block
    When "GET /api/blocks/[id]" returns no match
    Then the page shows a not-found state with a way to search

  @backend-ready @P-1
  Scenario: Block fetch error shows an error boundary
    Given "GET /api/blocks/[id]" returns an error
    Then the block page shows an error boundary with a retry affordance

  # ===========================================================================
  # Address page  (#/address/:id)
  # ===========================================================================

  @backend-ready @P-1
  Scenario: Address page shows balance and identity
    Given I open an address page at "#/address/:id"
    When "GET /api/address/[addr]" resolves
    Then I see the address and its SALT balance with grains where relevant
    But today the page reads design sample data and is not yet wired to "GET /api/address/[addr]"

  @backend-ready @P-1
  Scenario Outline: Address tabs render their content
    Given the address data has loaded
    When I select the "<tab>" tab
    Then the "<tab>" content is shown

    Examples:
      | tab          |
      | transactions |
      | tokens       |
      | analytics    |

  @backend-ready @P-1
  Scenario: Address transactions tab lists transactions
    Given the address has transactions
    When I open the transactions tab
    Then I see the address transactions, each linking to "#/tx/:id"
    And when there are none I see an empty state

  @backend-ready @P-1
  Scenario: Address tokens tab depends on the token indexer
    Given I open the tokens tab for an address
    When the token holdings are requested
    Then I see the address token holdings
    But this depends on indexer token_transfers which is not yet populated, so it may be empty

  @backend-ready @P-1
  Scenario: Address analytics tab shows activity over time
    Given the address has historical activity
    When I open the analytics tab
    Then I see activity charts for the address
    And when there is insufficient data I see an empty state

  @todo @P-6 @auth
  Scenario: Watch toggle adds the address to a watchlist
    Given I am authenticated
    When I activate the watch toggle on the address page
    Then the address is added to my watchlist
    And the toggle reflects the watched state
    But watchlist CRUD persistence does not exist yet, so the toggle is non-functional today

  @todo @P-6 @auth
  Scenario: Watch toggle is gated behind authentication
    Given I am not authenticated
    When I activate the watch toggle
    Then I am prompted to sign in before watching

  @todo @P-1
  Scenario: CSV export downloads the address transactions
    Given the address transactions are loaded
    When I select export to CSV
    Then a CSV file of the transactions is downloaded
    But the export button currently fakes success and produces no real file

  @backend-ready @P-1
  Scenario: Address page shows a loading skeleton
    Given I open an address page
    When "GET /api/address/[addr]" has not resolved
    Then the page shows skeletons for the balance and tabs

  @backend-ready @P-1
  Scenario: Address fetch error shows an error boundary
    Given "GET /api/address/[addr]" returns an error
    Then the address page shows an error boundary with a retry affordance

  @backend-ready @P-1 @mobile
  Scenario: Address page is usable on a mobile viewport
    Given I am on a mobile viewport
    When the address page renders
    Then the balance summary and tabs stack and remain readable
    And the tab strip is scrollable rather than clipped

  # ===========================================================================
  # Token page  (#/token/:id)
  # ===========================================================================

  @backend-ready @P-1
  Scenario: Token page shows token info
    Given I open a token page at "#/token/:id"
    Then I see the token name, symbol, decimals, and total supply
    But today the page reads design sample data and is not yet wired to live token data

  @todo @P-1
  Scenario Outline: Token tabs render their content
    Given the token page is loaded
    When I select the "<tab>" tab
    Then the "<tab>" content is shown

    Examples:
      | tab       |
      | supply    |
      | holders   |
      | transfers |
      | info      |

  @todo @P-1
  Scenario: Token holders tab depends on the token indexer
    Given I open the holders tab for a token
    When holders are requested
    Then I see the token holders ranked by balance
    But indexer token_transfers is never populated, so the holders list is empty today

  @todo @P-1
  Scenario: Token transfers tab depends on the token indexer
    Given I open the transfers tab for a token
    When transfers are requested
    Then I see the token transfers, each linking to "#/tx/:id"
    But indexer token_transfers is never populated, so the transfers list is empty today

  @todo @P-1
  Scenario: Token holders empty state is honest
    Given the token has no indexed holders
    When I open the holders tab
    Then I see an empty state explaining that holder data is not yet indexed
    And no fabricated holders are shown

  @backend-ready @P-1
  Scenario: Token page shows a loading skeleton
    Given I open a token page
    When token data has not resolved
    Then the page shows skeletons for the info and tabs

  @backend-ready @P-1
  Scenario: Unknown token shows a not-found state
    Given I open a token id that matches no token
    Then the page shows a not-found state with a way to search

  @backend-ready @P-1 @a11y
  Scenario: Entity page tabs are accessible tablists
    Given any entity page with tabs is rendered
    Then the tabs form a tablist with arrow-key navigation
    And the active tab and its panel are correctly associated for assistive technology
