# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Live DAG visualization
  As a visitor exploring the Citrate GHOSTDAG
  I want a live visualization of blocks, parents, tips, and finality with an accessible fallback
  So that I can watch and understand the BlockDAG structure of the Citrate testnet

  Background:
    Given the live DAG screen is opened at "#/dag"
    And the snapshot is served by "GET /api/dag" (tips, blue/red, maxBlueScore, finalityDepth 100)
    And the network is the Citrate testnet (chain 40204, native SALT)

  # ---------------------------------------------------------------------------
  # Rendering blocks, parents, tips
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: DAG renders blue and red nodes from the snapshot
    Given the DAG screen is rendered
    When "GET /api/dag" resolves
    Then blue-set blocks are rendered as blue nodes
    And red-set blocks are rendered as red nodes
    But today the visualization uses a random generator and is not yet wired to "GET /api/dag"

  @backend-ready @P-1
  Scenario: Selected-parent spine is distinct from merge edges
    Given the DAG has rendered
    Then the selected-parent edges form a solid spine
    And the merge-parent edges are drawn as dashed edges
    And the spine is visually distinguishable from the merge edges

  @backend-ready @P-1
  Scenario: Current tips are ringed
    Given the DAG has rendered
    Then each current tip from the snapshot is drawn with a ring
    And non-tip blocks are not ringed

  @backend-ready @P-1
  Scenario: Finality is conveyed by depth
    Given the DAG has rendered
    When finality is computed from depth against the threshold of 100
    Then final blocks are styled distinctly from maturing blocks
    And a maturing block conveys its depth toward 100

  # ---------------------------------------------------------------------------
  # Live stream (WSS) + pause/resume
  # ---------------------------------------------------------------------------

  @todo @P-5
  Scenario: DAG streams new blocks over a websocket
    Given the DAG screen is open
    When the WSS stream delivers a new block
    Then the new block is appended to the visualization in place
    And its colour, parents, and tip ring are drawn from the streamed data
    But no WSS subscription exists yet, so the stream is not wired today

  @todo @P-5
  Scenario: Pausing freezes the live stream
    Given the DAG is streaming live blocks
    When I activate pause
    Then incoming stream updates are buffered and not applied
    And the visualization holds its current state

  @todo @P-5
  Scenario: Resuming applies buffered updates
    Given the DAG stream is paused with buffered updates
    When I activate resume
    Then the buffered updates are applied
    And the stream continues live

  @todo @P-5
  Scenario: DAG falls back to snapshot polling when the websocket is unavailable
    Given the WSS stream cannot connect
    When the DAG screen loads
    Then it falls back to polling "GET /api/dag"
    And a banner notes that updates are polled rather than streamed

  @todo @P-5
  Scenario: DAG shows a reconnecting state when the stream drops
    Given the DAG is streaming live
    When the websocket connection drops
    Then a reconnecting indicator is shown
    And the last known DAG state remains visible

  # ---------------------------------------------------------------------------
  # Interaction → detail
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: Clicking a node opens its detail
    Given the DAG has rendered
    When I click a block node
    Then a detail panel or navigation to "#/block/:id" shows that block
    And its blue_score, parents, and finality are shown

  @backend-ready @P-1
  Scenario: Hovering a node previews its identity
    Given the DAG has rendered
    When I hover a block node
    Then a preview shows the block hash and blue_score

  # ---------------------------------------------------------------------------
  # Linear / accessible fallback (a11y)
  # ---------------------------------------------------------------------------

  @todo @P-1 @a11y
  Scenario: A parallel accessible list represents the DAG
    Given the DAG canvas is rendered
    Then a parallel accessible list of recent blocks is present alongside the canvas
    And each list item names the block, its blue or red colour, its parents, and its finality

  @todo @P-1 @a11y
  Scenario: Accessible list is keyboard navigable and selectable
    Given the accessible DAG list is present
    When I navigate it by keyboard
    Then each block is focusable
    And activating a block opens its detail at "#/block/:id"

  @todo @P-1 @a11y
  Scenario: DAG honours reduced-motion preferences
    Given the visitor prefers reduced motion
    When the DAG renders and streams
    Then animations and transitions are minimised or disabled
    And updates appear without motion that violates the preference

  @todo @P-1 @a11y
  Scenario: Colour is not the only signal for blue versus red
    Given the DAG has rendered
    Then blue and red blocks are also distinguished by a non-colour cue
    And the distinction is described in the accessible list

  # ---------------------------------------------------------------------------
  # Loading, empty, error, mobile
  # ---------------------------------------------------------------------------

  @backend-ready @P-1
  Scenario: DAG shows a loading state before the snapshot resolves
    Given the DAG screen is opening
    When "GET /api/dag" has not resolved
    Then a loading state is shown for the canvas and the accessible list

  @backend-ready @P-1
  Scenario: DAG shows an empty state when the snapshot has no blocks
    Given "GET /api/dag" resolves with no blocks
    Then an empty state explains that no DAG data is available yet

  @backend-ready @P-1
  Scenario: DAG shows an error state when the snapshot fails
    Given "GET /api/dag" returns an error
    Then an error state is shown with a retry affordance
    And no fabricated DAG is rendered in place of live data

  @backend-ready @P-1 @mobile
  Scenario: DAG is usable on a mobile viewport
    Given I am on a mobile viewport
    When the DAG screen renders
    Then the canvas fits the viewport with pan and zoom
    And the accessible list remains reachable for navigation
