# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

Feature: Settings wired to real backends
  As a signed-in visitor or developer on CitrateScan
  I want every Settings section backed by a real persistent service
  So that my account, appearance, privacy, keys, watchlist, security
  and transparency controls actually do what they say.

  # Today only Appearance works and only in memory; Account, Privacy, API keys,
  # Watchlist, Security and Transparency are non-functional placeholders, and
  # login is the hardcoded alice.ctr (no real auth). Settings live at "#/account".
  # Routes that already work: GET /api/account/export, GET/POST /api/keys.
  # Routes still missing: /api/settings (E2EE read/write), watchlist CRUD,
  # DELETE /api/account, threads/messages save/load.

  Background:
    Given I open CitrateScan settings at "#/account"

  # ===========================================================================
  # ACCOUNT  (@P-0)
  # ===========================================================================

  @todo @P-0 @auth
  Scenario: A signed-in visitor sees their real account, not the hardcoded alice.ctr
    Given I have signed in with Privy
    When I open the Account section
    Then I see my real address and a SALT balance shown with grains
    And I see my login method and any linked accounts
    But I never see the placeholder identity alice.ctr

  @todo @P-0 @auth
  Scenario: A signed-out visitor is prompted to sign in before account settings load
    Given I am not signed in
    When I open the Account section
    Then I am prompted to sign in with Privy
    And no account fields are shown until authentication succeeds

  @todo @P-0 @auth
  Scenario: A visitor links and unlinks an additional account
    Given I am signed in and viewing the Account section
    When I link an additional login method
    Then it appears in my linked accounts list
    And I can unlink it again, provided at least one login method remains

  @todo @P-0 @auth @wagmi
  Scenario: A visitor exports their embedded-wallet private key with explicit confirmation
    Given I am signed in with a Privy embedded wallet
    When I choose to export my embedded-wallet key
    Then I must pass an explicit security confirmation step before the key is revealed
    And the key is revealed only client-side and is never sent to CitrateScan servers
    And a warning explains that anyone holding this key controls the wallet

  @todo @P-0 @auth
  Scenario: A visitor signs out of the current session
    Given I am signed in
    When I choose "Sign out"
    Then my current session is ended and I am returned to a signed-out state

  @todo @P-0 @auth @security
  Scenario: A visitor signs out everywhere
    Given I am signed in across multiple devices
    When I choose "Sign out everywhere"
    Then all of my active sessions are revoked
    And any other device must re-authenticate on its next request

  # ===========================================================================
  # APPEARANCE  (theme/verbosity/reduced-motion → localStorage @P-6)
  # ===========================================================================

  @wired @P-1
  Scenario: Appearance changes apply immediately within the current session
    Given the Appearance section is the only functional settings section today
    When I switch the theme between light and dark
    And I change the answer verbosity
    And I toggle reduced motion
    Then each change is reflected in the UI immediately

  @todo @P-6
  Scenario Outline: Appearance preferences persist to localStorage across reloads
    When I set theme to "<theme>", verbosity to "<verbosity>" and reduced motion to "<motion>"
    And I reload CitrateScan
    Then my appearance preferences are restored from localStorage as theme "<theme>", verbosity "<verbosity>" and reduced motion "<motion>"
    And the preference applies before first paint so there is no flash of the wrong theme

    Examples:
      | theme | verbosity | motion |
      | light | concise   | off    |
      | dark  | detailed  | on     |

  @todo @P-6 @a11y
  Scenario: Reduced motion honours the operating-system preference as a default
    Given my operating system requests reduced motion and I have set no explicit preference
    When CitrateScan loads
    Then reduced motion is enabled by default
    And animated surfaces such as the DAG canvas respect it

  # ===========================================================================
  # PRIVACY & DATA  (@P-3)
  # ===========================================================================

  @backend-ready @P-3 @gdpr
  Scenario: A visitor exports their data from Privacy and Data
    Given I am signed in
    When I choose "Export my data"
    Then the export is served by "GET /api/account/export"
    And I download a machine-readable copy of the data CitrateScan holds about me

  @todo @P-3 @gdpr
  Scenario: A visitor deletes their chat and search history without deleting the account
    Given I am signed in and have saved threads and messages
    When I choose "Delete history" and confirm
    Then my stored threads and messages are deleted
    But my account, keys and watchlist remain intact

  @todo @P-3 @gdpr @auth
  Scenario: A visitor deletes their account and all associated data
    Given I am signed in
    When I choose "Delete account" and pass the confirmation step
    Then the request is served by "DELETE /api/account"
    And my account, threads, messages, watchlist, API keys and audit logs are erased
    And I am signed out and cannot sign back into the deleted account

  @todo @P-6 @security
  Scenario: Privacy and Data discloses the encryption status of stored settings
    When I view the Privacy and Data section
    Then it discloses whether my account settings are end-to-end encrypted
    And it states that encrypted fields cannot be read by CitrateScan servers
    And it names where the data is stored

  # ===========================================================================
  # API KEYS  (issue/copy-once/revoke/quota → /api/keys @P-6)
  # ===========================================================================

  @backend-ready @P-6 @auth
  Scenario: A developer issues an API key shown exactly once
    Given I am signed in on the API keys section
    When I issue a new API key
    Then the request is served by "POST /api/keys"
    And the full secret is shown exactly once with a copy control
    And only a salted hash is stored, so the secret cannot be shown again
    And the key appears in my key list by its label and prefix

  @backend-ready @P-6 @auth
  Scenario: A developer lists their existing API keys
    Given I have previously issued API keys
    When I open the API keys section
    Then the list is served by "GET /api/keys"
    And each key shows its label, prefix, creation date and remaining quota
    But no full secret is ever shown again

  @todo @P-6 @auth
  Scenario: A developer revokes an API key
    Given I have an active API key
    When I revoke it
    Then it is marked revoked and can no longer authenticate against the developer API
    And it is shown as revoked in my key list

  @todo @P-6 @P-7
  Scenario: API-key quota is visible and enforced
    Given I have an API key with a request quota
    When I view the key in settings
    Then I see the quota and how much of it I have consumed
    And requests beyond the quota are rejected with a rate-limit response by the developer API

  # ===========================================================================
  # WATCHLIST & ALERTS  (add/remove/toggle, persisted @P-6)
  # ===========================================================================

  @todo @P-6 @auth
  Scenario: A visitor adds an address to their watchlist
    Given I am signed in
    When I add an address to my watchlist with a label
    Then it is persisted via the watchlist service
    And it appears in my watchlist after reload

  @todo @P-6 @auth
  Scenario: A visitor removes a watchlist entry
    Given I have a watchlist entry
    When I remove it
    Then it is deleted from the watchlist service and no longer appears after reload

  @todo @P-6 @auth
  Scenario: A visitor toggles alerts for a watched address
    Given I have a watchlist entry with alerts off
    When I toggle alerts on
    Then the alert preference is persisted for that entry
    And the entry shows alerts as enabled after reload

  @todo @P-6 @auth @mobile
  Scenario: The watchlist is usable on a small screen
    Given I am signed in on a mobile viewport
    When I open the watchlist section
    Then entries, add, remove and toggle controls are reachable and tappable without horizontal scrolling

  # ===========================================================================
  # SECURITY  (active sessions, passkeys, revoke @P-6)
  # ===========================================================================

  @todo @P-6 @auth @security
  Scenario: A visitor reviews their active sessions
    Given I am signed in
    When I open the Security section
    Then I see each active session with its device, approximate location and last-seen time
    And my current session is clearly marked

  @todo @P-6 @auth @security
  Scenario: A visitor revokes a single remote session
    Given I have more than one active session
    When I revoke a session that is not my current one
    Then that session is ended and must re-authenticate on its next request

  @todo @P-6 @auth @security
  Scenario: A visitor registers and removes a passkey
    Given I am signed in
    When I add a passkey
    Then the passkey is registered for my account and can be used to sign in
    And I can remove the passkey later, provided another login method remains

  # ===========================================================================
  # TRANSPARENCY  (system prompt, tool allowlist, audit log, provenance @P-6)
  # ===========================================================================

  @todo @P-6
  Scenario: A visitor reads the agent system prompt
    When I open the Transparency section
    Then I can view the exact system prompt that governs the Ask-CitrateScan agent

  @todo @P-6 @security
  Scenario: A visitor reviews the read-only tool allowlist
    When I view the agent tool allowlist in Transparency
    Then I see the 13 read-only tools the agent is permitted to call, including explainTransaction
    And the list states that the agent has no state-changing or write tools

  @todo @P-6 @auth
  Scenario: A visitor reviews their recent agent audit log
    Given I am signed in and have used the agent
    When I open the recent audit log in Transparency
    Then I see my recent agent invocations with their timestamps and the tools each call used
    And the audit entries match what "POST /api/chat" logged

  @todo @P-6
  Scenario: A visitor reads the source, commit and model provenance
    When I view the provenance panel in Transparency
    Then I see the source repository link, the deployed build commit and the inference model identifier
    And the model identifier matches the model served at infer.citrate.ai

  # ===========================================================================
  # DEVELOPER  (RPC URL, add-chain via wallet_addEthereumChain, SDK/MCP links)
  # ===========================================================================

  @todo @P-6
  Scenario: A developer copies the public RPC endpoint
    When I open the Developer section
    Then I see the public RPC URL rpc.citrate.ai and its websocket endpoint
    And I can copy each with one action

  @todo @P-6 @wagmi
  Scenario: A developer adds Citrate to their wallet in one click
    Given I have an injected wallet available
    When I choose "Add Citrate to wallet"
    Then CitrateScan calls wallet_addEthereumChain with chain id 40204, native currency SALT and the Citrate RPC and explorer URLs
    And my wallet prompts me to add the network
    But if no injected wallet is present I am told to install or connect one

  @todo @P-6 @P-7
  Scenario: A developer reaches the SDK and MCP resources
    When I view the Developer section
    Then I see links to the SDK and to the MCP endpoint at "/api/mcp"
    And the links route to the developer hub at "#/apis" for full documentation

  # ===========================================================================
  # Reliability of the settings surface itself
  # ===========================================================================

  @todo @P-1 @P-8
  Scenario: A settings section shows an honest error when its backend is unreachable
    Given the settings backend at "/api/settings" is unreachable
    When I open a section that depends on it
    Then I see an honest error state with a retry control
    And no stale or sample values are presented as if they were my real settings
