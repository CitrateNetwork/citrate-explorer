# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Omni-search resolution
  As a visitor searching CitrateScan
  I want a single search box that resolves any Citrate entity by the shape of my input
  So that I can reach an address, transaction, block, label, or contract without choosing a category

  Background:
    Given the omni-search is available in the header and on the home screen
    And resolution is served by "GET /api/search?q="
    And the network is the Citrate testnet (chain 40204, native SALT)

  # ---------------------------------------------------------------------------
  # Resolution by input shape
  # ---------------------------------------------------------------------------

  @backend-ready @P-1 @search
  Scenario: Resolve a 40-hex address
    Given I enter a 40-hex value prefixed with "0x"
    When I submit the search
    Then "GET /api/search" is called with the value
    And the resolver classifies it as an address
    And I am routed to the address page at "#/address/:id"

  @backend-ready @P-1 @search
  Scenario: Resolve a 64-hex hash that is a transaction
    Given I enter a 64-hex value
    When I submit the search
    And the resolver finds a matching transaction
    Then I am routed to the transaction page at "#/tx/:id"

  @backend-ready @P-1 @search
  Scenario: Resolve a 64-hex hash that is a block hash
    Given I enter a 64-hex value
    When I submit the search
    And the resolver finds a matching block hash rather than a transaction
    Then I am routed to the block page at "#/block/:id"

  @backend-ready @P-1 @search
  Scenario: Resolve an integer block height
    Given I enter a plain integer
    When I submit the search
    Then the resolver classifies it as a block height
    And I am routed to the block page for that height

  @backend-ready @P-1 @search
  Scenario: Resolve a human label
    Given I enter a label such as "alice.ctr"
    When I submit the search
    Then the resolver attempts to resolve the label to an address
    And on success I am routed to the resolved address page

  @backend-ready @P-1 @search
  Scenario: Resolve a contract and function reference
    Given I enter a contract address with a function name
    When I submit the search
    Then the resolver classifies it as a contract reference
    And I am routed to the contract page at "#/contract/:id" focused on that function

  @backend-ready @P-1 @search
  Scenario Outline: Input shape drives the resolved entity type
    Given I enter "<query>"
    When I submit the search
    Then "GET /api/search" classifies it as "<entity>"
    And I am routed to "<route>"

    Examples:
      | query                                                              | entity   | route          |
      | 0x52908400098527886E0F7030069857D2E4169EE7                         | address  | #/address/:id  |
      | 0x4e3a3754410177e6937ef1f84bba68ea139e8d1a2258c5f85db9f1cd715a1bdd | tx       | #/tx/:id       |
      | 1024                                                                | block    | #/block/:id    |
      | alice.ctr                                                           | label    | #/address/:id  |

  # ---------------------------------------------------------------------------
  # Natural language → agent handoff
  # ---------------------------------------------------------------------------

  @backend-ready @P-2 @search
  Scenario: Natural-language query hands off to the agent
    Given I enter a natural-language question that is not an entity shape
    When I submit the search
    Then the resolver signals a natural-language handoff
    And the agent drawer opens pre-filled with my question
    And on wiring the question is sent to "POST /api/chat"

  @backend-ready @P-2 @search
  Scenario: Ambiguous query offers both a best match and an agent handoff
    Given I enter a query that partially matches an entity and reads as a question
    When the resolver returns a best-effort match plus a handoff suggestion
    Then I am shown the best match
    And I am offered to ask the agent instead

  # ---------------------------------------------------------------------------
  # Not found, loading, error
  # ---------------------------------------------------------------------------

  @backend-ready @P-1 @search
  Scenario: Not found for a well-formed but unknown value
    Given I enter a well-formed hash that exists on no entity
    When the resolver returns no match
    Then I see a not-found message for the query
    And I am offered to ask the agent about it

  @backend-ready @P-1 @search
  Scenario: Search shows a loading state while resolving
    Given I submit a query
    When the "GET /api/search" response is pending
    Then a loading indicator is shown on the search affordance
    And the input remains editable

  @backend-ready @P-1 @search
  Scenario: Search shows an error state when resolution fails
    Given I submit a query
    When "GET /api/search" returns an error
    Then I see an error message inviting me to retry
    And I am not silently routed to an incorrect entity

  @backend-ready @P-1 @search
  Scenario: Empty submission is ignored
    Given the omni-search input is empty or whitespace only
    When I submit
    Then no request is made to "GET /api/search"
    And focus remains in the input

  # ---------------------------------------------------------------------------
  # A11y and mobile
  # ---------------------------------------------------------------------------

  @backend-ready @P-1 @search @a11y
  Scenario: Search results are announced to assistive technology
    Given I submit a query that resolves to multiple candidate rows
    Then the result count is announced via a live region
    And each result row is reachable and selectable by keyboard

  @backend-ready @P-1 @search @mobile
  Scenario: Search is usable on a mobile viewport
    Given I am on a mobile viewport
    When I focus the omni-search and enter a query
    Then the results presentation fits the viewport without horizontal scrolling
    And submitting routes me to the resolved entity
