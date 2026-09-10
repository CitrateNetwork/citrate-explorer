# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@a11y @P-8
Feature: Accessibility to WCAG 2.1 AA
  As a visitor using a keyboard, a screen reader or assistive settings
  I want CitrateScan to meet WCAG 2.1 AA
  So that I can search, read entities, drive the agent and understand the DAG
  without a pointer and without losing information to motion or low contrast.

  # The shipped SPA uses clickable divs in places, a canvas-only DAG with no
  # accessible alternative, and animated marquees. This feature drives the
  # remediation and the CI gate. ChainBadge and streaming answers must announce
  # via aria-live so screen-reader users perceive live updates.

  Background:
    Given CitrateScan targets WCAG 2.1 AA conformance
    And accessibility is enforced by an automated axe and Lighthouse gate in CI

  # ---------------------------------------------------------------------------
  # Keyboard navigation
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Every interactive element is reachable and operable by keyboard
    Given I navigate CitrateScan using only the keyboard
    When I Tab through a major screen
    Then focus moves in a logical reading order through every interactive element
    And I can activate each control with Enter or Space as appropriate
    And no interactive element is reachable only by pointer

  @todo
  Scenario: A skip link lets keyboard users bypass the header
    Given I load any screen and press Tab once
    Then a visible "Skip to main content" link receives focus
    And activating it moves focus past the marquee header to the main content

  @todo
  Scenario: Focus is never trapped except in intentional modals
    Given I open and then close the command palette or the agent drawer
    When I continue tabbing
    Then focus returns to a sensible location and is not trapped on the page
    But while a modal dialog is open focus is intentionally contained within it

  # ---------------------------------------------------------------------------
  # Visible focus and semantic elements
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Every focusable element shows a visible focus ring
    Given I move focus with the keyboard
    Then each focused element displays a clearly visible focus indicator
    And the indicator meets the AA non-text contrast requirement against its background

  @todo
  Scenario: Controls use semantic elements rather than clickable divs
    Given I inspect the interactive surfaces of CitrateScan
    Then actions use semantic button elements
    And navigations use semantic anchor elements with real href values
    But no clickable div or span stands in for a button or a link

  # ---------------------------------------------------------------------------
  # Command palette and agent drawer
  # ---------------------------------------------------------------------------

  @todo
  Scenario: The command palette is fully keyboard operable
    Given I press the command palette shortcut
    Then the palette opens with focus on its input and is announced as a dialog
    And I can move through results with the arrow keys and choose one with Enter
    And I can dismiss it with Escape, which returns focus to the trigger

  @todo @P-2
  Scenario: The agent drawer is keyboard operable and announces streamed answers
    Given I open the Ask-CitrateScan drawer with the keyboard
    Then focus moves into the drawer and it is announced as a complementary region or dialog
    And I can type a question, submit it and Tab to the cited entity chips
    And I can close the drawer with Escape and return focus to its trigger

  # ---------------------------------------------------------------------------
  # DAG canvas accessible alternative
  # ---------------------------------------------------------------------------

  @todo @P-5
  Scenario: The DAG canvas has a parallel accessible list representation
    Given the Live DAG screen at "#/dag" renders the GHOSTDAG canvas
    When I navigate with a screen reader
    Then a parallel accessible representation lists the recent blocks with their blue_score, blue or red classification and parent relationships
    And the canvas is marked so assistive technology is directed to the accessible list
    And the list conveys selected parents versus merge parents in text

  @todo @P-5
  Scenario: The DAG list stays usable when reduced motion is on
    Given reduced motion is enabled
    When I view the Live DAG screen
    Then the accessible block list continues to update with new blocks
    But the canvas animation is reduced or stilled

  # ---------------------------------------------------------------------------
  # Reduced motion and contrast
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Reduced motion is honoured across animated surfaces
    Given reduced motion is requested by my system or my appearance setting
    When I browse CitrateScan
    Then the marquee logo, transitions and the DAG animation are reduced or disabled
    And no essential information is conveyed by motion alone

  @todo
  Scenario: Text and UI colour contrast meet AA
    Given I view text and interactive components in both light and dark themes
    Then body text meets a contrast ratio of at least 4.5 to 1
    And large text and non-text UI indicators meet at least 3 to 1
    And status colours such as blue and red blocks are not the only signal of meaning

  # ---------------------------------------------------------------------------
  # Screen-reader labels and live regions
  # ---------------------------------------------------------------------------

  @todo
  Scenario: The live chain badge announces updates via an aria-live region
    Given the ChainBadge reads "GET /api/dag" for tips, blue or red counts and maxBlueScore
    When the chain state updates
    Then the badge updates are announced through a polite aria-live region
    And the badge has an accessible name describing the current chain health

  @todo @P-2
  Scenario: Streaming agent answers are announced progressively
    Given I asked the Ask-CitrateScan agent a question
    When the answer streams in from "POST /api/chat"
    Then the streamed text is exposed through an aria-live region so a screen reader can follow it
    And tool-trace updates are announced without flooding the user with noise

  @todo
  Scenario: Entity and form controls have accessible names
    Given I encounter the omni-search, filters, copy buttons and entity chips
    Then each control has a programmatic accessible name
    And icon-only controls expose a text label to assistive technology

  @todo @mobile
  Scenario: Touch targets meet the minimum size on mobile
    Given I use CitrateScan on a mobile viewport
    Then interactive targets meet the AA minimum target size with adequate spacing
    And focus and active states remain perceivable

  # ---------------------------------------------------------------------------
  # CI enforcement
  # ---------------------------------------------------------------------------

  @todo
  Scenario: The accessibility CI gate blocks merges that introduce violations
    Given the axe and Lighthouse accessibility checks run on every pull request
    When a change introduces a WCAG 2.1 AA violation on a covered screen
    Then the accessibility gate fails the build
    And the failure report names the rule, the element and the screen

  @todo
  Scenario Outline: The a11y gate covers each major screen
    Given the accessibility gate audits "<route>"
    When the audit runs
    Then it reports zero critical or serious violations for that screen

    Examples:
      | route          |
      | #/             |
      | #/tx/:id       |
      | #/block/:id    |
      | #/address/:id  |
      | #/token/:id    |
      | #/contract/:id |
      | #/dag          |
      | #/apis         |
      | #/account      |
