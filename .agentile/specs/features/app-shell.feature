# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Global application shell
  As a visitor to CitrateScan
  I want a persistent shell with branding, search, a command palette, a live chain badge, an agent, and a footer
  So that I can navigate the Citrate testnet explorer and trust what I am looking at

  Background:
    Given the CitrateScan SPA is loaded
    And the network is the Citrate testnet (chain 40204, native SALT)

  # ---------------------------------------------------------------------------
  # Marquee logo + wordmark
  # ---------------------------------------------------------------------------

  @wired @P-1 @branding
  Scenario: Header shows the marquee logo and wordmark
    Given the header is rendered
    Then I see the CitrateScan marquee logo
    And I see the "CitrateScan" wordmark next to it
    And clicking the logo navigates to the home route "#/"

  @wired @P-1 @branding @a11y
  Scenario: Logo is a semantic link with an accessible name
    Given the header is rendered
    When a screen reader inspects the logo
    Then the logo is an anchor element, not a clickable div
    And it exposes an accessible name of "CitrateScan home"

  # ---------------------------------------------------------------------------
  # Omni-search input (header)
  # ---------------------------------------------------------------------------

  @backend-ready @P-1 @search
  Scenario: Header omni-search resolves a query
    Given the cursor is in the header omni-search input
    When I type a 40-hex address and submit
    Then a request is made to "GET /api/search?q=" with that address
    And on resolution I am routed to the matching address page

  @backend-ready @P-1 @search
  Scenario: Header omni-search shows a loading affordance while resolving
    Given I have submitted a query in the header omni-search
    When the "GET /api/search" response is still pending
    Then the input shows an in-progress indicator
    And the input remains focusable so I can edit the query

  @backend-ready @P-1 @search
  Scenario: Header omni-search surfaces a not-found result inline
    Given I submit a query that matches no entity
    When "GET /api/search" returns no match
    Then I see an inline "No results" message
    And I am offered to ask the agent about the query instead

  @wired @P-1 @search @a11y
  Scenario: Omni-search input is labelled and keyboard reachable
    Given the header is rendered
    Then the omni-search input has an associated accessible label
    And it can be reached by keyboard tabbing from the logo

  # ---------------------------------------------------------------------------
  # Command palette (⌘K)
  # ---------------------------------------------------------------------------

  @backend-ready @P-1 @search
  Scenario: Opening the command palette with the keyboard shortcut
    Given the shell is focused
    When I press ⌘K (or Ctrl+K)
    Then the command palette opens as a modal dialog
    And focus moves into the palette query input

  @backend-ready @P-1 @search
  Scenario: Command palette shows a resolved-entity row for a recognised query
    Given the command palette is open
    When I type a 64-hex hash
    And "GET /api/search" resolves it to a transaction
    Then I see a resolved-entity row describing the transaction
    And selecting it navigates to that transaction page

  @wired @P-1 @search
  Scenario: Command palette shows jump-to navigation rows
    Given the command palette is open
    When I type "blocks"
    Then I see jump-to rows for explorer destinations such as latest blocks and the live DAG
    And selecting a jump-to row navigates to that destination

  @backend-ready @P-2 @search
  Scenario: Command palette offers an ask-the-agent row for natural language
    Given the command palette is open
    When I type a natural-language question
    Then I see an "Ask the agent" row at the bottom of the results
    And selecting it opens the agent drawer pre-filled with my question

  @wired @P-1 @search @a11y
  Scenario: Command palette supports keyboard navigation between rows
    Given the command palette is open with several result rows
    When I press the down arrow
    Then the next row becomes highlighted as the active option
    And when I press the up arrow the previous row is highlighted
    And when I press Enter the highlighted row is activated

  @wired @P-1 @search @a11y
  Scenario: Command palette closes on Escape and restores focus
    Given the command palette is open
    When I press Escape
    Then the palette closes
    And focus returns to the element that was focused before it opened

  @wired @P-1 @search @a11y
  Scenario: Command palette traps focus while open
    Given the command palette is open
    When I tab past the last focusable control
    Then focus cycles back to the first focusable control inside the palette
    And focus never lands on the page behind the modal

  @wired @P-1 @search @mobile
  Scenario: Command palette is reachable without a physical keyboard on mobile
    Given I am on a mobile viewport with no hardware keyboard
    Then a visible command-palette trigger is present in the header
    And tapping it opens the palette

  # ---------------------------------------------------------------------------
  # Live ChainBadge (the only thing wired to live data today)
  # ---------------------------------------------------------------------------

  @wired @P-1 @backend-ready
  Scenario: ChainBadge reflects the live GHOSTDAG snapshot
    Given the header is rendered
    When the ChainBadge polls "GET /api/dag"
    Then it shows the live max blue score
    And it indicates the Citrate testnet (chain 40204)

  @wired @P-1
  Scenario: ChainBadge shows a loading state on first paint
    Given the header is rendering for the first time
    When the first "GET /api/dag" request has not yet resolved
    Then the ChainBadge shows a loading placeholder rather than stale or zero data

  @wired @P-1
  Scenario: ChainBadge degrades honestly when the snapshot fails
    Given the ChainBadge has loaded once
    When a subsequent "GET /api/dag" poll fails
    Then the badge shows a degraded or stale indicator
    And it does not silently present sample data as if it were live

  # ---------------------------------------------------------------------------
  # Ask button + agent drawer toggle
  # ---------------------------------------------------------------------------

  @wired @P-1
  Scenario: Ask button toggles the persistent agent drawer
    Given the header is rendered
    When I click the Ask button
    Then the Ask-CitrateScan agent drawer opens
    And when I click the Ask button again the drawer closes

  @todo @P-2
  Scenario: Agent drawer is wired to the live chat endpoint
    Given the agent drawer is open
    When I send a question
    Then the question is sent to "POST /api/chat"
    And the response streams token by token
    And tool traces from the read-only tools are shown
    But today the drawer is scripted with regex and setTimeout and does not call the endpoint

  @wired @P-1 @a11y
  Scenario: Agent drawer toggle is announced to assistive technology
    Given the header is rendered
    Then the Ask button exposes its expanded or collapsed state
    And when the drawer opens focus moves into the drawer

  @wired @P-1 @mobile
  Scenario: Agent drawer adapts to a mobile viewport
    Given I am on a mobile viewport
    When I open the agent drawer
    Then the drawer presents as a full-height or sheet layout suited to small screens
    And the underlying content is not horizontally clipped

  # ---------------------------------------------------------------------------
  # Status banners (RPC reconnecting / indexer lag)
  # ---------------------------------------------------------------------------

  @todo @P-1
  Scenario: RPC reconnecting banner appears when the node connection drops
    Given the shell has an active RPC connection
    When the RPC connection to rpc.citrate.ai is lost
    Then a status banner reading that the explorer is reconnecting is shown
    And the banner clears automatically once the connection is restored

  @todo @P-1
  Scenario: Indexer lag banner appears when the indexer falls behind
    Given the indexer head is significantly behind the chain head
    Then a banner warns that indexed data may lag the live chain
    And the banner names the approximate lag

  @todo @P-1 @a11y
  Scenario: Status banners are announced politely and are dismissible
    Given a status banner is shown
    Then it is exposed as a live region so assistive technology announces it
    And it can be dismissed with the keyboard

  @todo @P-1
  Scenario: Status banners do not stack or obscure the omni-search
    Given both the RPC reconnecting and indexer lag conditions are active
    Then at most one prioritised banner is shown at a time
    And the header omni-search remains usable

  # ---------------------------------------------------------------------------
  # Footer (must exist — currently missing entirely)
  # ---------------------------------------------------------------------------

  @todo @P-3 @footer
  Scenario: Footer is present on every screen
    Given any CitrateScan screen is loaded
    Then a footer is rendered at the bottom of the page

  @todo @P-3 @footer @branding
  Scenario: Footer shows brand, version, and build commit
    Given the footer is rendered
    Then I see the CitrateScan brand and version
    And I see the current build commit
    And I see the network labelled as "Citrate testnet"

  @todo @P-3 @footer
  Scenario: Footer provides explorer, developer hub, and status navigation
    Given the footer is rendered
    Then I see a navigation group linking to the explorer
    And I see a link to the developer hub at "#/apis"
    And I see a link to the network status page

  @todo @P-3 @footer @gdpr
  Scenario: Footer links to the legal pages
    Given the footer is rendered
    Then I see a link to the privacy policy at "/privacy"
    And I see a link to the terms at "/terms"
    And I see a link to the cookie policy at "/cookies"

  @todo @P-3 @footer
  Scenario: Footer links to source and social
    Given the footer is rendered
    Then I see a link to the source repository
    And I see at least one social or contact link

  @todo @P-3 @footer @a11y
  Scenario: Footer uses semantic landmarks and accessible links
    Given the footer is rendered
    Then it is exposed as a contentinfo landmark
    And every footer link is a semantic anchor with discernible text

  @todo @P-3 @footer @mobile
  Scenario: Footer reflows on a mobile viewport
    Given I am on a mobile viewport
    When the footer is rendered
    Then the footer navigation groups stack vertically
    And no content overflows the viewport width
