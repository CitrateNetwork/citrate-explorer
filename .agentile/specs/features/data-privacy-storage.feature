# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@gdpr @security @P-6
Feature: Data privacy and the hybrid storage model
  As an auditor and as a visitor who entrusts CitrateScan with settings and keys
  I want a transparent, defensible storage model with real data-subject rights
  So that the explorer is GDPR and CCPA compliant and never holds data it should not be able to read.

  The model is hybrid. Account settings and logins are end-to-end encrypted with a key derived
  client-side from a wallet signature, so the server stores ciphertext it cannot read. Our own
  issued API keys are stored as salted SHA-256 with a pepper, shown once, never recoverable.
  Third-party provider keys are encrypted at rest with AES-256-GCM under a per-user HKDF key so
  the agent can use them server-side. Every agent tool call is audit-logged. GDPR export is real
  at "GET /api/account/export"; erasure at "DELETE /api/account" is specified but not yet built.
  On-chain data is permanent and this is disclosed honestly.

  Background:
    Given I am signed in with a verified Privy session
    And my user data is partitioned into E2EE settings, our hashed API keys, and encrypted provider keys

  # ===================== E2EE ACCOUNT SETTINGS AND LOGINS =====================

  @todo @security
  Scenario: Settings are encrypted client-side before they leave the browser
    Given I derive an encryption key client-side from a wallet signature
    When I save my account settings
    Then the settings are encrypted in the browser
    And only ciphertext is sent to "/api/settings"
    And the server stores ciphertext it cannot decrypt

  @todo @security
  Scenario: Settings are decrypted client-side on read
    Given my settings are stored as server-side ciphertext
    When I load "#/account" and re-derive my key from a wallet signature
    Then the client fetches the ciphertext and decrypts it locally
    And my plaintext settings are never present on the server

  @todo @security @error
  Scenario: The server cannot read E2EE settings even if compelled
    Given an auditor inspects the settings record at rest
    Then only ciphertext and non-sensitive metadata are present
    And no field reveals plaintext settings or login details

  @todo @error
  Scenario: Losing the derivation signature means settings cannot be recovered
    Given my settings are E2EE under a wallet-derived key
    When I can no longer produce the wallet signature
    Then the server cannot recover my plaintext settings
    And the UI is honest that E2EE data is unrecoverable without the key

  # ===================== OUR ISSUED API KEYS (HASHED) =====================

  @backend-ready @security
  Scenario: Issued API keys are salted-hashed and shown once
    When I create an API key via "POST /api/keys"
    Then the plaintext is shown exactly once
    And the server persists only a salted SHA-256 hash combined with a server-side pepper
    And the plaintext is never recoverable or re-displayable

  @backend-ready @security
  Scenario: Authenticating an API key compares against the hash
    Given I present an issued API key on a request
    When the server validates it
    Then it hashes the presented key with the same salt and pepper and compares to the stored hash
    And no plaintext key is ever stored or logged

  # ===================== THIRD-PARTY PROVIDER KEYS (ENCRYPTED AT REST) =====================

  @todo @security
  Scenario: A third-party provider key is encrypted at rest with AES-256-GCM
    Given I add a third-party inference provider key so the agent can use it on my behalf
    When the key is stored
    Then it is encrypted with AES-256-GCM under a per-user key derived via HKDF
    And the ciphertext, nonce, and auth tag are stored, not the plaintext

  @todo @security
  Scenario: The agent uses a provider key server-side only
    Given I have a stored, encrypted provider key
    When the agent needs it for a server-side call
    Then it is decrypted in memory on the server for the duration of the call
    And it is never returned to the client or written to logs

  @todo @security @error
  Scenario: Provider key ciphertext fails authentication if tampered
    Given a provider key record is altered at rest
    When the server attempts AES-256-GCM decryption
    Then the GCM auth tag check fails and the key is treated as invalid
    And the tampering is surfaced rather than silently using corrupt data

  # ===================== AUDIT LOG =====================

  @backend-ready @security
  Scenario: Every agent tool call is audit-logged
    Given the agent runs read-only tools on my behalf
    When a tool call executes
    Then an audit entry records the tool name, timestamp, and my user id
    And the audit log is scoped so I see only my own entries

  @todo @gdpr
  Scenario: Audit history is included in my data export
    Given I have an audit history
    When I export my data
    Then my audit entries are included in the export payload

  # ===================== GDPR EXPORT (RIGHT TO ACCESS) =====================

  @backend-ready @gdpr
  Scenario: Export my data
    Given I am signed in
    When I call "GET /api/account/export"
    Then I receive a machine-readable export of my account data
    And it includes my settings metadata, API-key metadata, provider-key metadata, and audit history
    But it does not include any recoverable secret such as a plaintext API key

  @backend-ready @gdpr @auth @error
  Scenario: Export requires authentication
    Given I am logged out
    When I call "GET /api/account/export"
    Then the request is rejected with 401
    And no data is returned

  # ===================== GDPR ERASURE (RIGHT TO BE FORGOTTEN) =====================

  @todo @gdpr
  Scenario: Erase my account
    Given I am signed in
    When I confirm deletion via "DELETE /api/account"
    Then my E2EE settings ciphertext, hashed API keys, encrypted provider keys, and audit log are deleted
    And my Privy sessions are revoked
    And subsequent authenticated calls for my prior user id return no data

  @todo @gdpr @error
  Scenario: Erasure requires explicit confirmation
    Given I open the delete-account flow
    When I do not explicitly confirm the irreversible deletion
    Then no data is deleted

  @todo @gdpr
  Scenario: Erasure is honest about on-chain data
    Given I request erasure
    When the deletion completes for off-chain data
    Then I am clearly told that on-chain transactions, addresses, and contracts on Citrate are permanent and cannot be erased
    And only the off-chain account data CitrateScan controls is deleted

  @todo @gdpr @error
  Scenario: Erasure endpoint does not exist yet today
    Given "DELETE /api/account" is specified but not yet implemented
    When the erasure flow is invoked before the route exists
    Then the UI states erasure is not yet available rather than implying data was deleted

  # ===================== TRANSPARENCY =====================

  @todo @gdpr
  Scenario: Transparency surface explains the hybrid storage model
    Given I open the privacy and transparency section at "#/account"
    Then I see plainly what is E2EE, what is hashed, and what is encrypted at rest
    And I see that on-chain data is permanent and public
    And I see links to the privacy policy, terms, and cookie policy from the footer
