# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@gdpr @P-3
Feature: Region-aware cookie consent and privacy compliance
  As a privacy-conscious visitor to CitrateScan
  I want a clear, granular cookie-consent surface that respects my region
  So that no non-essential cookies are set without my informed consent
  and I can exercise my data rights at any time.

  # CitrateScan today ships NO footer, NO cookie banner, NO legal pages and no
  # consent surface (see brief: "NO FOOTER. NO cookie-consent banner."). Every
  # scenario below is therefore @todo unless it leans on an already-real route.
  # The hybrid data model: most reads are public chain data; the only cookies
  # that touch personal data come from Privy (auth/embedded wallet) and any
  # opt-in analytics. Essential cookies = Privy session + consent record itself.

  Background:
    Given CitrateScan is served from the production domain explorer.citrate.ai
    And the cookie-consent system can classify cookies as essential, analytics or preferences
    And the analytics scripts are gated behind a consent check, not loaded on import

  # ---------------------------------------------------------------------------
  # First visit
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A first-time visitor sees the consent banner before non-essential cookies are set
    Given I have never visited CitrateScan and hold no stored consent record
    When I open the home screen at "#/"
    Then a cookie-consent banner is shown
    And the banner explains that essential cookies are required for the site to function
    And the banner names the non-essential categories analytics and preferences
    And no analytics cookie is present in my browser
    And no analytics network request has been issued
    And the banner links to the cookie policy at "/cookies"
    And the banner does not block keyboard access to the rest of the page behind it

  @todo @a11y
  Scenario: The consent banner is fully keyboard and screen-reader operable
    Given I am a first-time visitor using only a keyboard
    When the consent banner appears
    Then focus is moved to the banner and trapped within its controls until a choice is made
    And every control is a semantic button reachable by Tab with a visible focus ring
    And the banner is announced as a dialog with an accessible name referencing cookie consent
    And I can choose accept all, reject all or manage preferences without a pointer

  # ---------------------------------------------------------------------------
  # Granular choice
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A visitor accepts all cookie categories
    Given the consent banner is shown to a first-time visitor
    When I choose "Accept all"
    Then a consent record is persisted with essential, analytics and preferences all granted
    And the analytics scripts are then loaded and may set their cookies
    And the banner is dismissed
    And the recorded consent includes a timestamp in ISO 8601 and the policy version accepted

  @todo
  Scenario Outline: A visitor sets granular consent per category from the preferences panel
    Given the consent banner is shown
    When I open "Manage preferences"
    And I set analytics to "<analytics>" and preferences to "<preferences>"
    And I save my choices
    Then a consent record is persisted with essential granted, analytics "<analytics>" and preferences "<preferences>"
    And the essential category is shown as always on and cannot be toggled off
    But analytics cookies are only set when analytics is granted

    Examples:
      | analytics | preferences |
      | granted   | granted     |
      | granted   | denied      |
      | denied    | granted     |
      | denied    | denied      |

  @todo @wagmi @auth
  Scenario: The banner discloses Privy and embedded-wallet cookies as essential when authenticated features are used
    Given the consent banner preferences panel is open
    When I read the essential cookies disclosure
    Then it discloses that Privy sets cookies to maintain my login session
    And it discloses that signing in provisions an embedded wallet whose session is cookie-backed
    And it states that these cookies are only set after I choose to sign in
    And it links to the privacy policy section that enumerates the hybrid data model

  # ---------------------------------------------------------------------------
  # Reject all
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Reject all keeps the explorer fully usable
    Given the consent banner is shown to a first-time visitor
    When I choose "Reject all"
    Then a consent record is persisted with analytics denied and preferences denied
    And no analytics cookie is set and no analytics request is issued
    And I can still search, open a transaction at "#/tx/:id" and view a block
    And the persistent Ask-CitrateScan drawer still opens
    But signing in still works because the Privy session cookie is classified as essential

  # ---------------------------------------------------------------------------
  # Returning with stored consent
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A returning visitor with a valid consent record is not re-prompted
    Given I previously saved a consent record for the current policy version
    When I return to CitrateScan
    Then the consent banner is not shown again
    And cookies are loaded exactly per my stored choices
    And a persistent control to reopen consent preferences remains available in the footer

  @todo
  Scenario: A returning visitor is re-prompted when the cookie policy version has changed
    Given I previously saved a consent record for policy version "2026-05-01"
    And the current cookie policy version is "2026-06-03"
    When I return to CitrateScan
    Then the consent banner is shown again and notes that the policy has been updated
    And my prior choices are preserved as the pre-filled defaults until I reconfirm
    And no newly added non-essential category is treated as consented until I accept it

  # ---------------------------------------------------------------------------
  # Change consent later
  # ---------------------------------------------------------------------------

  @todo
  Scenario: A visitor changes a previously granted consent to denied
    Given I have a stored consent record granting analytics
    When I reopen consent preferences from the footer link
    And I set analytics to denied and save
    Then the updated consent record is persisted with a new ISO 8601 timestamp
    And existing analytics cookies are cleared on the next navigation
    And no further analytics requests are issued

  # ---------------------------------------------------------------------------
  # EU (GDPR) vs California (CCPA) vs rest-of-world
  # ---------------------------------------------------------------------------

  @todo
  Scenario: An EU visitor gets an opt-in GDPR banner with no pre-checked non-essential boxes
    Given my request resolves to an EU member-state region
    When the consent banner is shown on first visit
    Then it is presented as an opt-in GDPR banner
    And analytics and preferences are unchecked by default
    And no non-essential cookie is set until I explicitly grant it

  @todo
  Scenario: A California visitor gets a CCPA Do-Not-Sell control
    Given my request resolves to the California region
    When the consent banner is shown
    Then it presents a "Do not sell or share my personal information" control
    And the privacy policy link explains the CCPA right to opt out of sale or sharing
    And choosing Do-Not-Sell is persisted in the consent record

  @todo
  Scenario: A rest-of-world visitor still receives an honest banner
    Given my request resolves to a region outside the EU and California
    When the consent banner is shown
    Then a baseline notice with accept all, reject all and manage preferences is presented
    And non-essential cookies are still gated behind an explicit choice

  @todo
  Scenario: Region detection failure fails closed to the strictest regime
    Given the region of my request cannot be determined
    When the consent banner is shown
    Then it defaults to the GDPR opt-in regime with nothing pre-consented
    And no non-essential cookie is set until I explicitly grant it

  # ---------------------------------------------------------------------------
  # Consent record and audit
  # ---------------------------------------------------------------------------

  @todo @security
  Scenario: A durable, auditable consent record is written
    When I make any consent choice
    Then a consent record is stored containing the categories chosen, the policy version, the region regime applied and an ISO 8601 timestamp
    And the record is retrievable so an auditor can confirm consent was obtained before non-essential cookies were set
    And the record contains no more personal data than necessary to prove consent

  @backend-ready @gdpr
  Scenario: A visitor exercises the right of access by exporting their data
    Given I am signed in
    When I request a data export from the privacy surface
    Then the request is served by "GET /api/account/export"
    And I receive a machine-readable export of the data CitrateScan holds about me

  @todo @gdpr
  Scenario: A visitor exercises the right to erasure
    Given I am signed in and have a consent record and stored account data
    When I request account deletion from the privacy surface
    Then the request is served by "DELETE /api/account"
    And my account data and consent record are erased
    And I am signed out and the consent banner is shown again on next visit
