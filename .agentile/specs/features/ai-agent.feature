# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@P-2
Feature: Ask-CitrateScan AI agent
  As a visitor exploring the Citrate Network
  I want to ask CitrateScan questions in plain English and get cited, tool-grounded answers
  So that I can understand transactions, addresses, contracts, and the DAG without reading raw data.

  The backend is real: "POST /api/chat" streams answers from an agent with 13 read-only tools
  (getTransaction, getAddress, exploreDag and others), an explainTransaction helper, a Privy
  auth gate, and per-user audit logging. Today the drawer UI is scripted with regex and
  setTimeout and never calls "POST /api/chat". This feature wires the drawer to the live agent.

  Background:
    Given the persistent "Ask-CitrateScan" drawer is available from the header
    And "POST /api/chat" is reachable and streams responses

  # --- Core ask flow ---

  @backend-ready
  Scenario: Ask a natural-language question and stream a cited answer
    Given I open the Ask-CitrateScan drawer
    When I ask "what is the current finality depth and how many tips are there"
    Then the drawer posts my question to "POST /api/chat"
    And live tool-traces appear as the agent calls read-only tools such as exploreDag
    And a streamed answer renders progressively
    And the answer includes citations linking back to the entities it used

  @backend-ready
  Scenario: Answer entities render as clickable chips
    Given the agent has answered a question that references a transaction and an address
    When the answer finishes streaming
    Then the referenced transaction renders as a chip linking to "#/tx/:id"
    And the referenced address renders as a chip linking to "#/address/:addr"

  @backend-ready
  Scenario: Live tool traces show each read-only tool call
    Given I ask a question that requires multiple lookups
    When the agent runs
    Then I see each tool call labelled with its tool name and arguments
    And each trace shows a pending then completed state
    And no write or state-changing tool ever appears in the trace

  # --- Entry points into the agent ---

  @backend-ready
  Scenario: Explain this transaction from a transaction page
    Given I am on a transaction page "#/tx/:id"
    When I click the "Explain this transaction" marquee action
    Then the drawer opens pre-seeded with that transaction hash
    And the agent calls explainTransaction and getTransaction for that hash
    And I receive a plain-English explanation of what the transaction did

  @backend-ready
  Scenario: Explain this contract from a contract page
    Given I am on a contract page "#/contract/:addr"
    When I choose "Explain this contract"
    Then the drawer opens scoped to that contract address
    And the agent summarises the contract's purpose using read-only tools and any verified ABI

  @backend-ready
  Scenario: Diagnose a failed transaction
    Given I am on a transaction page for a reverted transaction
    When I ask the agent why it failed
    Then the agent inspects the transaction and explains the likely failure cause
    And it cites the specific fields it relied on

  @backend-ready
  Scenario: Inline "Explain / Ask about this" on an entity chip
    Given any entity chip is shown on a page or in an answer
    When I choose "Ask about this" on the chip
    Then the drawer opens scoped to that entity
    And my next question is answered in the context of that entity

  @backend-ready
  Scenario: Ask row in the command palette
    Given I open the command palette with the keyboard shortcut
    When I type a question into the ask row and submit
    Then the Ask-CitrateScan drawer opens and posts the question to "POST /api/chat"

  # --- Auth and audit ---

  @backend-ready @auth @security
  Scenario: Agent requests are gated by the Privy session
    Given the agent endpoint enforces verifyPrivySession
    When a request to "POST /api/chat" arrives without a valid session
    Then the server responds 401
    And the drawer prompts me to sign in before asking

  @backend-ready @security
  Scenario: Every agent tool call is audit-logged per user
    Given I am signed in and ask a question
    When the agent executes its read-only tools
    Then each tool call is recorded in the per-user audit log with a timestamp
    And the audit entries are attributed only to my user id

  # --- Edge, error, loading, offline ---

  @backend-ready @error
  Scenario: Question cannot be resolved to any entity
    Given I open the drawer
    When I ask something the tools cannot ground, such as a nonexistent hash
    Then the agent says it could not find the entity rather than inventing an answer
    And it offers a suggestion for how to refine the query

  @backend-ready
  Scenario: Streaming response shows a clear loading state
    Given I have submitted a question
    When the agent is still working
    Then a streaming indicator and partial tokens are visible
    And the input is disabled or queued until the response settles

  @backend-ready @error
  Scenario: Agent stream is interrupted
    Given a streamed answer is in progress
    When the connection to "POST /api/chat" drops
    Then the drawer shows an honest "response interrupted" state
    And I can retry the question without losing my prior messages

  @backend-ready @error
  Scenario: Rate limit is reached
    Given I have sent many questions in a short window
    When "POST /api/chat" returns a rate-limit response
    Then the drawer tells me I am sending requests too quickly and when I can retry

  @todo @error
  Scenario: Asking while offline
    Given my browser is offline
    When I submit a question
    Then the drawer shows an offline state and queues or blocks the send honestly
    And it does not fall back to the old scripted setTimeout answer

  # --- A11y and mobile ---

  @backend-ready @a11y
  Scenario: Drawer is keyboard and screen-reader accessible
    Given I open the Ask-CitrateScan drawer
    Then focus moves into the drawer and is trapped while it is open
    And the message log is an accessible live region announcing new content
    And entity chips are semantic links with accessible names
    And Escape closes the drawer and restores focus to the trigger

  @backend-ready @mobile
  Scenario: Drawer is usable on a small viewport
    Given I am on a 375px-wide viewport
    When I open the Ask-CitrateScan drawer
    Then it presents full-width without clipping the input or send control
    And tool-traces and citations remain readable and tappable
