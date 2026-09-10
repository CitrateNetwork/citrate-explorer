# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@P-1 @P-8
Feature: Honest loading, empty, error and offline states
  As a visitor relying on CitrateScan for ground truth
  I want loading skeletons, empty states, real error boundaries and honest
  offline or degraded banners
  So that I am never shown stale sample data dressed up as live chain state.

  # Today loading/empty/error are demo toggles; there are no real
  # error.tsx/loading.tsx/not-found.tsx boundaries, nav("verify") is a dead
  # route, and most screens read design sample data (SD) rather than /api.
  # The honesty rule: when the RPC or indexer is down, the visitor must SEE
  # that — sample-data fallback must never mask an outage.

  Background:
    Given CitrateScan reads live data from the Citrate RPC and the indexer
    And sample design data must never be substituted silently for live data

  # ---------------------------------------------------------------------------
  # Loading skeletons per major screen
  # ---------------------------------------------------------------------------

  @todo
  Scenario Outline: Each major screen shows a real loading skeleton while its data is in flight
    Given the data for "<screen>" served by "<endpoint>" has not yet resolved
    When I open "<route>"
    Then a loading skeleton shaped like the final content is shown
    And no sample placeholder values are shown as if they were real
    And the skeleton is replaced by live data once "<endpoint>" resolves

    Examples:
      | screen      | route          | endpoint               |
      | Home        | #/             | /api/blocks            |
      | Transaction | #/tx/:id       | /api/tx/[hash]         |
      | Block       | #/block/:id    | /api/blocks/[id]       |
      | Address     | #/address/:id  | /api/address/[addr]    |
      | Token       | #/token/:id    | /api/address/[addr]    |
      | Contract    | #/contract/:id | /api/contract/[addr]   |
      | Live DAG    | #/dag          | /api/dag               |
      | Search      | #/             | /api/search            |

  # ---------------------------------------------------------------------------
  # Empty states per major screen
  # ---------------------------------------------------------------------------

  @todo
  Scenario: An address with no activity shows an honest empty state
    Given an address resolves successfully but has no transactions
    When I open its address screen
    Then I see an empty state explaining there is no activity yet
    But the SALT balance and the account summary still render

  @todo
  Scenario: A token with no transfers shows an honest empty state
    Given the indexer has not populated token_transfers for a token
    When I open its token screen at "#/token/:id"
    Then the holders and transfers lists show an empty state
    And the empty state explains that transfer indexing is not yet available rather than implying zero transfers exist

  @todo
  Scenario: A search with no match shows an honest empty state
    Given my query matches no address, transaction or block
    When the search served by "GET /api/search" returns no result
    Then I see a no-results empty state with guidance on accepted query forms
    And I am offered to ask the agent instead

  @todo
  Scenario: A block with no transactions shows an empty transactions list
    Given a block resolves successfully but contains no transactions
    When I open its block screen
    Then the transactions list shows an empty state
    But the block header, blue_score and parents still render

  # ---------------------------------------------------------------------------
  # Error boundaries
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A route-level error boundary catches a render failure
    Given a screen throws during render
    When I am on that screen
    Then the route error boundary at error.tsx renders a recovery UI
    And I am offered a retry that re-attempts the segment
    And the rest of the application shell, including the header and footer, remains usable

  @todo
  Scenario: A global error boundary catches a top-level failure
    Given the application shell itself fails to render
    Then the global-error.tsx boundary renders a minimal recovery page
    And it offers a reload and a link back to the home screen

  @todo
  Scenario Outline: A failed entity fetch shows an error state with retry, not a blank screen
    Given "<endpoint>" returns a server error for an otherwise valid identifier
    When I open "<route>"
    Then I see an error state explaining the data could not be loaded
    And a retry control re-requests "<endpoint>"
    And no sample data is shown in place of the failed live data

    Examples:
      | route          | endpoint             |
      | #/tx/:id       | /api/tx/[hash]       |
      | #/block/:id    | /api/blocks/[id]     |
      | #/address/:id  | /api/address/[addr]  |
      | #/contract/:id | /api/contract/[addr] |

  # ---------------------------------------------------------------------------
  # Not-found and the dead verify route
  # ---------------------------------------------------------------------------

  @todo
  Scenario: An unknown route renders the not-found page
    When I navigate to a route that does not exist
    Then the not-found.tsx page renders with status 404
    And it offers search and a link back to the home screen

  @todo
  Scenario: A well-formed but non-existent transaction hash is not-found, not an error
    Given a transaction hash is syntactically valid but matches no transaction
    When I open its transaction screen
    Then I see a not-found state distinct from a server error
    And I am told the transaction may not be indexed yet or may not exist

  @todo
  Scenario: The dead verify route no longer dead-ends
    Given the contract verify engine is not yet implemented
    When I trigger the navigation that today calls nav("verify")
    Then I land on a real route that either presents the verify flow or an honest not-yet-available state
    But I never reach a blank or broken dead route

  # ---------------------------------------------------------------------------
  # Offline and RPC-down honesty
  # ---------------------------------------------------------------------------

  @todo
  Scenario: An RPC outage shows an honest degraded banner instead of sample data
    Given the Citrate RPC at rpc.citrate.ai is unreachable
    When I use CitrateScan
    Then a degraded banner states that live chain data is currently unavailable
    And screens that depend on the RPC show error or empty states, never sample data presented as live
    And the ChainBadge reflects the degraded state rather than a stale healthy reading

  @todo @mobile
  Scenario: A browser offline state is surfaced honestly
    Given my browser reports it is offline
    When I interact with CitrateScan
    Then an offline banner is shown
    And actions that require the network are disabled with an explanation
    And the banner clears automatically when connectivity returns

  @todo
  Scenario: The indexer catching up is disclosed, not hidden
    Given the indexer is behind the chain tip
    When I view freshness-sensitive screens such as Home or an address history
    Then an indexer-catching-up notice discloses that recent data may be incomplete
    And the notice names roughly how far behind the tip the indexer is

  @todo @P-2
  Scenario: The inference service warming up is disclosed in the agent drawer
    Given the inference service at infer.citrate.ai is warming up
    When I send a message to the Ask-CitrateScan agent
    Then I see an inference-warming state rather than a silent hang or a fabricated answer
    And the agent retries or lets me retry once the service is ready

  # ---------------------------------------------------------------------------
  # Slow network and retry behaviour
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A slow response keeps the skeleton visible without deceiving the visitor
    Given an entity endpoint is responding slowly but has not failed
    When I open the screen
    Then the loading skeleton remains visible
    And after a long delay I am offered the option to keep waiting or retry
    But I am never shown sample data as a substitute for the slow live response

  @todo
  Scenario: Retrying a previously failed fetch succeeds without a full reload
    Given an entity fetch failed and I am viewing its error state
    When the underlying service recovers and I choose retry
    Then the data loads in place and the error state is replaced by live content
    And I did not need to reload the whole application
