# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@auth @P-0
Feature: Real Privy authentication
  As a visitor to CitrateScan
  I want to sign in with a real wallet, email, or passkey
  So that my identity is verified server-side and gates the actions that need it.

  Today the header ships a hardcoded "alice.ctr" login with no real session, while
  the backend already gates POST /api/chat and POST/GET /api/keys behind verifyPrivySession.
  This feature replaces the fake login with a real Privy session and wires the UI to that gate.

  Background:
    Given the <Providers> tree (Privy, Wagmi, QueryClient) is mounted at the application root
    And the Privy app id is configured from the server environment

  # --- Logged-out header state ---

  @todo
  Scenario: Logged-out visitor sees a sign-in entry point, not a hardcoded identity
    Given I have no active Privy session
    When I load the home screen at "#/"
    Then the header shows a "Sign in" button
    And the header does not show "alice.ctr"
    And the header does not show any connected address
    And the settings gear and Ask button remain available for read-only browsing

  @todo
  Scenario: Public read-only browsing works while logged out
    Given I am logged out
    When I open a transaction page at "#/tx/:id"
    Then the transaction details render normally
    But any auth-gated action on the page prompts me to sign in first

  # --- Login methods ---

  @todo
  Scenario: Sign in with an embedded wallet
    Given I am logged out
    And I click "Sign in"
    When I choose "Embedded wallet" in the Privy modal
    And I complete the embedded-wallet flow
    Then a Privy session is established
    And the header shows my connected address truncated as "0x1234…abcd"
    And useAccount reports status "connected" on chain 40204

  @todo
  Scenario: Sign in with email
    Given I am logged out
    And I open the Privy modal
    When I enter my email and submit the one-time code
    Then a Privy session is established
    And an embedded wallet is provisioned for my account
    And the header shows my connected address

  @todo
  Scenario: Sign in with a passkey
    Given I am logged out
    And my device supports WebAuthn passkeys
    When I choose "Passkey" in the Privy modal and authenticate biometrically
    Then a Privy session is established
    And the header reflects the connected state

  @todo @error
  Scenario: Visitor cancels the login modal
    Given I am logged out
    And I open the Privy modal
    When I dismiss the modal without completing login
    Then no session is created
    And the header still shows "Sign in"
    And no error toast is shown

  @todo @error
  Scenario: Login fails because Privy is unreachable
    Given I am logged out
    And the Privy service cannot be reached
    When I attempt to sign in
    Then I see an honest error message that sign-in is temporarily unavailable
    And I am not shown a fake or partial session

  # --- Connected header + account menu ---

  @todo
  Scenario: Connected header shows the address and an account menu
    Given I am signed in with address "0x1234…abcd"
    When I view the header
    Then I see my truncated address and a menu affordance
    When I open the account menu
    Then I see entries for "Settings", "API keys", "Sign out", and "Sign out everywhere"
    And I see my full address with a copy control

  @todo @mobile
  Scenario: Account menu is reachable on a small viewport
    Given I am signed in
    And I am on a 375px-wide viewport
    When I open the collapsed header menu
    Then the account menu and sign-out controls are reachable without horizontal scroll

  @todo @a11y
  Scenario: Account menu is keyboard and screen-reader accessible
    Given I am signed in
    When I tab to the account menu trigger and press Enter
    Then the menu opens with focus moved to the first item
    And the trigger is a semantic button with an accessible name
    And Escape closes the menu and returns focus to the trigger

  # --- Logout ---

  @todo
  Scenario: Log out of the current device
    Given I am signed in
    When I select "Sign out" from the account menu
    Then my local Privy session is cleared
    And the header returns to the logged-out "Sign in" state
    And subsequent calls to auth-gated APIs return 401

  @todo @security
  Scenario: Sign out everywhere revokes all sessions
    Given I am signed in on this device
    And I have an active session on another device
    When I select "Sign out everywhere"
    Then all of my Privy sessions are revoked server-side
    And the other device is logged out on its next verifyPrivySession check
    And I am returned to the logged-out state on this device

  # --- Server-side session verification ---

  @backend-ready @security
  Scenario: Server verifies the session token on a gated request
    Given I am signed in
    When the client sends a request to "POST /api/chat" with my Privy token
    Then verifyPrivySession validates the token server-side
    And the resolved user id is used to scope the request

  @backend-ready @security @error
  Scenario: Forged or expired token is rejected
    Given a request to "POST /api/keys" carries an invalid or expired Privy token
    When verifyPrivySession runs
    Then the server responds 401 Unauthorized
    And no key is issued and no user data is returned

  # --- Auth-gated actions ---

  @todo @security
  Scenario: Issuing an API key requires authentication
    Given I am logged out
    When I attempt to create an API key from the developer hub at "#/apis"
    Then I am prompted to sign in
    And no call to "POST /api/keys" is made until a session exists
    When I sign in and retry
    Then the key is issued and shown once

  @todo
  Scenario: Saving account settings requires authentication
    Given I am logged out
    When I attempt to save settings at "#/account"
    Then I am prompted to sign in before any write is attempted

  @todo @wagmi
  Scenario: Writing a contract requires a connected wallet
    Given I am logged out
    When I open the Write tab on a contract page
    Then the write controls prompt me to sign in and connect a wallet
    And no transaction or relay request is built until useAccount is connected

  @backend-ready @security
  Scenario: The agent scopes audit and tool access per authenticated user
    Given I am signed in as user A
    When I ask the agent a question via "POST /api/chat"
    Then the audit log entries for the tool calls are attributed to user A
    And user A cannot read user B's audit history

  # --- Dev fallback ---

  @todo
  Scenario: Dev fallback identity when Privy is unconfigured locally
    Given the Privy app id is not configured in the local environment
    And the application is running in development mode
    When I load CitrateScan
    Then a clearly labelled "dev fallback" identity is used
    And a banner indicates authentication is running in development fallback mode
    And the dev fallback is never enabled in production builds

  @todo @security
  Scenario: Production refuses to start without auth configuration
    Given the application is built for production
    And the Privy configuration is missing
    Then the build or boot fails loudly
    And no anonymous or hardcoded identity is silently substituted
