# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Home screen
  As a visitor arriving at CitrateScan
  I want a hero with search, live chain context, and the latest activity
  So that I can immediately orient myself and start exploring the Citrate testnet

  Background:
    Given the home route "#/" is loaded
    And the network is the Citrate testnet (chain 40204, native SALT)

  # ---------------------------------------------------------------------------
  # Hero + omni-search
  # ---------------------------------------------------------------------------

  @wired @P-1
  Scenario: Hero presents the explorer and a prominent search
    Given the home screen is rendered
    Then I see a hero introducing CitrateScan as a Citrate testnet explorer
    And the hero contains a prominent omni-search input

  @backend-ready @P-1 @search
  Scenario: Submitting the hero search resolves a query
    Given the cursor is in the hero omni-search
    When I enter a query and submit
    Then a request is made to "GET /api/search?q="
    And on resolution I am routed to the matching entity page

  # ---------------------------------------------------------------------------
  # Prompt chips
  # ---------------------------------------------------------------------------

  @wired @P-1
  Scenario: Prompt chips suggest example explorations
    Given the home screen is rendered
    Then I see a row of prompt chips with example queries and questions

  @backend-ready @P-2
  Scenario: Selecting a natural-language prompt chip hands off to the agent
    Given the home screen shows prompt chips
    When I select a natural-language prompt chip
    Then the agent drawer opens pre-filled with that prompt
    And on wiring the question is sent to "POST /api/chat"

  @backend-ready @P-1 @search
  Scenario: Selecting an entity prompt chip runs a search
    Given the home screen shows prompt chips
    When I select a chip that names an address or hash
    Then "GET /api/search" is called with that value
    And I am routed to the resolved entity

  # ---------------------------------------------------------------------------
  # Live DAG mini-strip
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Home shows a live DAG mini-strip from the snapshot
    Given the home screen is rendered
    When the DAG mini-strip loads "GET /api/dag"
    Then it renders recent tips with blue and red colouring
    And selecting the strip navigates to the full live DAG at "#/dag"
    But today the strip reads design sample data and is not yet wired to the live snapshot

  @backend-ready @P-1
  Scenario: DAG mini-strip shows a loading skeleton before data
    Given the home screen is rendering
    When the "GET /api/dag" request has not resolved
    Then the mini-strip shows a skeleton placeholder

  @backend-ready @P-1
  Scenario: DAG mini-strip shows an error state when the snapshot fails
    Given the DAG mini-strip requested "GET /api/dag"
    When the request fails
    Then the strip shows an inline error with a retry affordance
    And it does not fall back to sample data presented as live

  # ---------------------------------------------------------------------------
  # Chain-status card
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Chain-status card summarises GHOSTDAG health
    Given the home screen is rendered
    When the chain-status card loads "GET /api/dag"
    Then it shows the max blue score, the number of current tips, and the finality depth of 100
    And it labels the network as the Citrate testnet
    But today the card reads design sample data and is not yet wired to the live snapshot

  @backend-ready @P-1
  Scenario: Chain-status card shows a loading state
    Given the home screen is rendering
    When the chain status request has not resolved
    Then the card shows loading placeholders for each metric

  @backend-ready @P-1
  Scenario: Chain-status card degrades honestly on failure
    Given the chain-status card requested the snapshot
    When the request fails
    Then the card indicates that live status is unavailable
    And it does not present stale sample values as current

  # ---------------------------------------------------------------------------
  # Latest blocks list
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Latest blocks list shows recent blocks
    Given the home screen is rendered
    When the latest blocks list loads "GET /api/blocks"
    Then it shows recent blocks with height, blue_score, and timestamp
    And each block links to its block page at "#/block/:id"
    But today the list reads design sample data and is not yet wired to "GET /api/blocks"

  @backend-ready @P-1
  Scenario: Latest blocks list shows a loading skeleton
    Given the home screen is rendering
    When "GET /api/blocks" has not resolved
    Then the latest blocks list shows row skeletons

  @backend-ready @P-1
  Scenario: Latest blocks list shows an empty state
    Given the home screen requested "GET /api/blocks"
    When the response contains no blocks
    Then the list shows an empty state explaining that no blocks are available yet

  @backend-ready @P-1
  Scenario: Latest blocks list shows an error state
    Given the home screen requested "GET /api/blocks"
    When the request fails
    Then the list shows an error with a retry affordance

  # ---------------------------------------------------------------------------
  # Latest transactions list
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Latest transactions list shows recent transactions
    Given the home screen is rendered
    When the latest transactions list loads recent transactions
    Then it shows recent transactions with hash, from, to, and value in SALT
    And each transaction links to its page at "#/tx/:id"
    But today the list reads design sample data and is not yet wired to live transactions

  @backend-ready @P-1
  Scenario: Latest transactions list shows a loading skeleton
    Given the home screen is rendering
    When the latest transactions have not resolved
    Then the transactions list shows row skeletons

  @backend-ready @P-1
  Scenario: Latest transactions list shows an empty state
    Given the latest transactions request resolved
    When there are no transactions to show
    Then the list shows an empty state

  @backend-ready @P-1
  Scenario: Latest transactions list shows an error state
    Given the latest transactions request failed
    Then the list shows an error with a retry affordance

  # ---------------------------------------------------------------------------
  # Cross-cutting: responsiveness, a11y, offline
  # ---------------------------------------------------------------------------

  @wired @P-1 @mobile
  Scenario: Home reflows to a single column on mobile
    Given I am on a mobile viewport
    When the home screen is rendered
    Then the hero, status card, and lists stack vertically
    And no content overflows the viewport width

  @wired @P-1 @a11y
  Scenario: Home uses semantic headings and landmarks
    Given the home screen is rendered
    Then the hero heading is the page's primary heading
    And the latest blocks and latest transactions sections have labelled headings

  @todo @P-1
  Scenario: Home shows an offline banner when the network is unreachable
    Given the browser goes offline
    When the home screen attempts to refresh live data
    Then an offline banner is shown
    And the lists retain their last loaded data rather than showing fabricated values
