# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@P-7
Feature: Developer API, API keys, and MCP server
  As a developer building on the Citrate Network
  I want an Etherscan-compatible REST API, managed API keys, and an MCP server
  So that I can query chain data programmatically and let my own agents call CitrateScan's tools.

  Today "GET /api/v1" implements only three actions with no key-gating or rate limiting,
  "GET/POST /api/mcp" returns a discovery manifest only with no JSON-RPC, and the developer hub
  at "#/apis" is a static design. API-key create and list at "GET/POST /api/keys" are real
  (salted hash, shown once) and need Neon plus auth. This feature specifies the full surface.

  Background:
    Given the base path "/api/v1" mirrors the Etherscan request convention of module, action, and apikey
    And the developer hub is reachable at "#/apis"

  # ===================== ETHERSCAN-COMPATIBLE REST =====================

  @backend-ready
  Scenario: Query an account balance in Etherscan-compatible form
    When I call "/api/v1?module=account&action=balance&address=0xabc&apikey=KEY"
    Then I receive a JSON body with status, message, and result fields
    And the result is the address balance in the smallest SALT unit

  @todo
  Scenario Outline: Supported modules and actions return Etherscan-shaped responses
    Given a valid API key
    When I call "/api/v1" with module "<module>" and action "<action>"
    Then the response uses the status, message, result envelope
    And the result matches the documented schema for that action

    Examples:
      | module      | action          |
      | account     | balance         |
      | account     | txlist          |
      | contract    | getabi          |
      | contract    | getsourcecode   |
      | transaction | gettxreceiptstatus |
      | block       | getblockreward  |
      | logs        | getLogs         |
      | stats       | saltsupply      |
      | gastracker  | gasoracle       |

  @todo @error
  Scenario: Unknown module or action returns a clean error envelope
    Given a valid API key
    When I call "/api/v1?module=bogus&action=nope&apikey=KEY"
    Then the response is status "0" with a message describing the unsupported request
    And the HTTP status is a 4xx, not a 500

  @todo @error
  Scenario: Token endpoints are honest about the empty indexer state
    Given the token_transfers table is not yet populated
    When I request token holders or token transfers via "/api/v1"
    Then the result is an empty set with a clear message
    And it is not silently presented as complete data

  # ===================== API KEY MANAGEMENT =====================

  @backend-ready @P-6 @security @auth
  Scenario: Issue an API key, shown once
    Given I am signed in
    When I create a key via "POST /api/keys"
    Then the plaintext key is returned exactly once in the response
    And the server stores only a salted SHA-256 hash with a pepper
    And the plaintext key is never retrievable afterwards

  @backend-ready @P-6 @auth
  Scenario: List my API keys without revealing secrets
    Given I am signed in and have created keys
    When I call "GET /api/keys"
    Then I see each key's label, prefix, creation date, and last-used time
    But I never see the full plaintext of any key

  @todo @auth
  Scenario: Revoke an API key
    Given I am signed in and hold an active key
    When I revoke that key
    Then subsequent "/api/v1" calls with it are rejected as unauthorized

  @todo @security @error
  Scenario: Request to /api/v1 without a key is rejected
    Given key-gating is enforced
    When I call "/api/v1" without an apikey
    Then the request is rejected as unauthorized
    And no chain data is returned

  @todo @security @error
  Scenario: Invalid API key is rejected by hash comparison
    Given key-gating is enforced
    When I call "/api/v1" with an apikey that does not match any stored hash
    Then the request is rejected
    And the comparison is made against the salted hash, never a stored plaintext

  # ----- Rate limiting and quota -----

  @todo @security
  Scenario: Per-key rate limiting
    Given my key has a per-second rate limit
    When I exceed that rate
    Then I receive a 429 with a Retry-After hint
    And requests within the limit continue to succeed

  @todo @security
  Scenario: Daily quota enforcement
    Given my key has a daily request quota
    When I exhaust the quota
    Then further requests are rejected until the quota window resets
    And the response states the quota was exceeded

  @todo
  Scenario: Usage is recorded per key
    Given I have made API calls with my key
    When I view usage in the developer hub
    Then I see request counts and last-used time reflecting my real usage

  # ===================== MCP SERVER =====================

  @backend-ready
  Scenario: MCP discovery manifest is served today
    When I call "GET /api/mcp"
    Then I receive a discovery manifest describing the CitrateScan MCP server

  @todo
  Scenario: MCP tools/list over JSON-RPC
    Given the MCP server exposes the read-only explorer tools
    When I send a JSON-RPC "tools/list" request to "/api/mcp"
    Then I receive the list of available tools with their input schemas
    And each tool corresponds to a read-only explorer capability

  @todo
  Scenario: MCP tools/call over JSON-RPC
    Given I have discovered a tool such as getTransaction via tools/list
    When I send a JSON-RPC "tools/call" for getTransaction with a hash
    Then I receive the tool result in JSON-RPC form
    And the call is read-only with no state change

  @todo @error
  Scenario: MCP rejects a malformed JSON-RPC request
    When I send an invalid JSON-RPC body to "/api/mcp"
    Then I receive a JSON-RPC error response with an appropriate code
    And the server does not crash or return a bare 500

  @todo @security @auth
  Scenario: MCP tools/call is gated and audited
    Given MCP tool calls require an API key or session
    When an unauthenticated client calls tools/call
    Then it is rejected
    And authorized tool calls are recorded in the audit log

  # ===================== DEVELOPER HUB UI =====================

  @todo
  Scenario: Developer hub lists endpoints and quickstarts
    Given I am on the developer hub at "#/apis"
    Then I see the available "/api/v1" modules and actions with example requests
    And I see quickstarts for the Etherscan-compatible REST API and the MCP server
    And I see how to create and use an API key

  @todo @auth
  Scenario: Developer hub key panel requires sign-in
    Given I am logged out
    When I open the API-keys panel in the developer hub
    Then I am prompted to sign in before any key is created or listed

  @todo @a11y
  Scenario: Quickstart code samples are accessible and copyable
    Given I am on the developer hub
    When I use the copy control on a code sample
    Then the sample copies to my clipboard
    And the copy control is a semantic button reachable by keyboard
