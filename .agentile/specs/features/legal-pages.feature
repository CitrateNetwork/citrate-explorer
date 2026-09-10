# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@P-3
Feature: Legal and policy pages with a compliant footer
  As a visitor, developer or auditor of CitrateScan
  I want reachable, indexable privacy, terms and cookie pages plus a security contact
  So that I can understand what is stored, exercise my data rights
  and report abuse or vulnerabilities.

  # Today CitrateScan has NO footer and NO legal pages (brief: "NO legal pages
  # (/privacy /terms /cookies). NO GDPR surface."). These pages must be SSR so
  # they are crawlable and shareable, unlike the ssr:false SPA shell. The
  # privacy policy must enumerate the hybrid data model and the data rights.

  Background:
    Given CitrateScan is served from explorer.citrate.ai
    And the legal pages are server-rendered so they are indexable by search engines

  # ---------------------------------------------------------------------------
  # Reachability
  # ---------------------------------------------------------------------------

  @todo
  Scenario Outline: Each legal page is reachable at its canonical route and renders server-side
    When I request "<route>" directly without first loading the SPA
    Then I receive a server-rendered HTML page with status 200
    And the page has the title "<title>"
    And the page shows a last-updated date in ISO 8601 format
    And the page opens with a plain-language summary before the formal text

    Examples:
      | route    | title          |
      | /privacy | Privacy policy |
      | /terms   | Terms of use   |
      | /cookies | Cookie policy  |

  @todo @security
  Scenario: A security and abuse contact is reachable
    When I look for how to report a vulnerability or abuse
    Then a security contact is published and reachable from the footer and the terms page
    And a machine-readable disclosure path is served at "/.well-known/security.txt"
    And the contact explains how to report a vulnerability responsibly

  # ---------------------------------------------------------------------------
  # Footer
  # ---------------------------------------------------------------------------

  @todo
  Scenario: The global footer links to every legal page and surfaces build provenance
    Given I am on any CitrateScan screen
    When I scroll to the footer
    Then the footer links to "/privacy", "/terms" and "/cookies"
    And the footer links to the explorer home, the developer hub and a status page
    And the footer links to the source repository and the security contact
    And the footer states the network is Citrate testnet with chain id 40204 and native SALT
    And the footer shows the build commit and app version
    And the footer exposes a control to reopen cookie-consent preferences

  @todo @a11y
  Scenario: The footer is navigable as a semantic landmark
    Given I am navigating with a keyboard and a screen reader
    When I reach the footer
    Then it is exposed as a contentinfo landmark
    And every footer link is a semantic anchor reachable by Tab with a visible focus ring

  # ---------------------------------------------------------------------------
  # Privacy policy content
  # ---------------------------------------------------------------------------

  @todo @gdpr
  Scenario: The privacy policy enumerates the hybrid data model
    When I read the privacy policy at "/privacy"
    Then it states that public chain data such as transactions, blocks and addresses is read from the Citrate network and is not personal data CitrateScan owns
    And it enumerates the personal data CitrateScan stores: the account and login method via Privy, the embedded-wallet association, saved threads and messages, the watchlist, API keys and audit logs
    And it discloses that data is held in Neon Postgres and that secrets remain server-only
    And it names the subprocessors: Privy for authentication, the inference provider at infer.citrate.ai, Neon for storage and the analytics provider if consented
    And it states the retention period for each category

  @todo @gdpr
  Scenario: The privacy policy spells out the data rights with the routes that fulfil them
    When I read the data-rights section of the privacy policy
    Then it explains the right of access and export and links to the export flow served by "GET /api/account/export"
    And it explains the right to erasure and links to the deletion flow served by "DELETE /api/account"
    And it explains the right to rectification and to withdraw consent
    And it explains the CCPA right to opt out of sale or sharing
    And it tells me how to contact CitrateScan to exercise a right that has no self-serve control

  @todo
  Scenario: The cookie policy is consistent with the consent banner categories
    When I read the cookie policy at "/cookies"
    Then it lists the same categories the consent banner uses: essential, analytics and preferences
    And it names the Privy session and embedded-wallet cookies as essential
    And it explains how to change consent at any time via the footer control

  # ---------------------------------------------------------------------------
  # Indexability and reliability
  # ---------------------------------------------------------------------------

  @todo @security @P-8
  Scenario: Legal pages are indexable and included in the sitemap
    When a crawler fetches "/privacy", "/terms" or "/cookies"
    Then the response is server-rendered HTML with a canonical URL and metadata
    And the page is listed in the sitemap and not disallowed by robots.txt

  @todo @P-8
  Scenario: A request for an unknown legal sub-path returns a real not-found page
    When I request "/privacy/unknown-section"
    Then I receive the not-found page with status 404
    And the not-found page links back to the legal pages and the home screen
