# CitrateScan feature spec
# created: 2026-06-03 · branch: citratescan-production-planset · author: Saul Loveman + Claude Opus 4.8 (1M context)

@security @P-8 @P-9
Feature: Production platform — security, SEO, rate limiting, monitoring and deploy
  As an operator and auditor of CitrateScan
  I want hardened security headers, an indexable SSR surface, rate-limited APIs,
  real monitoring and a clean Vercel deployment
  So that the public explorer is safe, discoverable, observable and shippable.

  # The current SPA is ssr:false and unindexable, has no security headers, no
  # rate limiting and no monitoring. This feature drives hardening (P-8) and
  # the deploy (P-9) to explorer.citrate.ai with an always-on indexer host and
  # provisioned Neon, Privy and inference services.

  Background:
    Given CitrateScan is deployed to Vercel and served from explorer.citrate.ai
    And secrets are server-only and never exposed to the client bundle

  # ---------------------------------------------------------------------------
  # Security headers and CSP
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Every response carries the baseline security headers
    When I request any CitrateScan page
    Then the response includes Strict-Transport-Security with a long max-age and includeSubDomains
    And the response includes X-Content-Type-Options nosniff
    And the response includes a Referrer-Policy of strict-origin-when-cross-origin
    And the response includes a Permissions-Policy that denies unused powerful features
    And the response sets frame-ancestors so the explorer cannot be framed by third parties

  @todo
  Scenario: The Content-Security-Policy allowlists exactly the required origins
    When I inspect the Content-Security-Policy on a CitrateScan response
    Then connect-src allows the Privy origins, rpc.citrate.ai over https and wss, infer.citrate.ai and the Neon data origin
    And frame-src allows the Privy origins required for authentication
    And the policy disallows inline script except via nonces or hashes
    And no wildcard origin is used for script-src or connect-src

  @todo
  Scenario: A disallowed origin is blocked by the CSP
    Given a script or connection targets an origin not on the allowlist
    When the page attempts it
    Then the CSP blocks the request
    And a CSP violation report is recorded for monitoring

  # ---------------------------------------------------------------------------
  # SEO: SSR entity pages, metadata, OG, robots, sitemap
  # ---------------------------------------------------------------------------

  @todo
  Scenario Outline: Each entity page is server-rendered with generateMetadata and an OG image
    When a crawler requests the server-rendered page for "<entity>"
    Then the response is indexable HTML with a 200 status
    And generateMetadata produced a unique title and description for that entity
    And an Open Graph image is provided so the link previews well when shared
    And a canonical URL is set

    Examples:
      | entity      |
      | transaction |
      | block       |
      | address     |
      | token       |
      | contract    |

  @todo
  Scenario: robots.txt permits indexing of public pages and points to the sitemap
    When I request "/robots.txt"
    Then it allows crawling of the public explorer and legal pages
    And it disallows private surfaces such as the account settings and API routes
    And it references the sitemap URL

  @todo
  Scenario: The sitemap lists the indexable surface
    When I request "/sitemap.xml"
    Then it lists the home, developer hub and legal pages
    And it is valid XML that a crawler can consume

  @todo
  Scenario: The explorer is genuinely indexable, unlike the client-only SPA shell
    Given the previous shell was ssr:false and unindexable
    When a search engine crawls an entity page
    Then it receives meaningful server-rendered content without executing client JavaScript
    And the page is eligible to appear in search results and rich link previews

  # ---------------------------------------------------------------------------
  # Rate limiting and WAF
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Read APIs are rate limited per client
    Given a single client floods the read APIs such as "GET /api/tx/[hash]" and "GET /api/search"
    When the client exceeds the configured threshold
    Then further requests receive a 429 with a Retry-After header
    And legitimate clients within the threshold are unaffected

  @todo @P-2
  Scenario: The chat endpoint is rate limited to protect inference capacity
    Given a client sends requests to "POST /api/chat" faster than the allowed rate
    When the client exceeds the threshold
    Then further requests receive a 429 with a Retry-After header
    And the limit is stricter than for cheap read endpoints to protect inference cost

  @todo @P-7
  Scenario: The developer API enforces key-based quotas at the edge
    Given a request to the developer API at "/api/v1" presents an API key
    When the key has exhausted its quota
    Then the request is rejected with a rate-limit response
    And anonymous requests without a key are limited more strictly than keyed requests

  @todo
  Scenario: A WAF mitigates abusive traffic patterns
    Given abusive or bot traffic targets the read APIs
    When the WAF rules match the pattern
    Then the offending requests are challenged or blocked at the edge
    And normal visitor traffic continues to be served

  # ---------------------------------------------------------------------------
  # Monitoring and health
  # ---------------------------------------------------------------------------

  @todo
  Scenario: Errors are captured by the error-tracking service with context
    Given error tracking is configured for both client and server
    When an unhandled error occurs
    Then it is reported with the release commit, the route and a scrubbed context
    But no secrets or personal data are included in the report

  @todo
  Scenario: Server logs are structured and correlatable
    When a request is served by any API route
    Then a structured log line is emitted with a request id, the route, the status and the latency
    And logs contain no secrets and redact any personal data

  @todo
  Scenario: The app health endpoint reports application status
    When I request "GET /api/health"
    Then it returns the application health including the deployed commit
    And it reports whether the RPC and the database dependencies are reachable

  @todo
  Scenario: The indexer health is observable
    When I query the indexer health
    Then it reports whether the indexer is running and how far behind the chain tip it is
    And an alert fires if the indexer falls too far behind or stops

  # ---------------------------------------------------------------------------
  # Deployment to Vercel
  # ---------------------------------------------------------------------------

  @todo @P-9
  Scenario: A pull request produces an isolated preview deployment
    Given I open a pull request
    When the Vercel build runs
    Then a preview deployment is created on a unique preview URL
    And the preview uses preview-scoped environment variables, not production secrets

  @todo @P-9
  Scenario: Merging to the default branch deploys to production at the custom domain
    Given a pull request is merged to the default branch
    When the production build runs and passes the CI gates
    Then it deploys to production and serves explorer.citrate.ai
    And production-scoped environment variables are used
    And HSTS and the security headers are present on the production domain

  @todo @P-9 @security
  Scenario: Environment variables are scoped and server-only secrets never reach the client
    Given environment variables are defined for development, preview and production
    When the client bundle is built
    Then only explicitly public variables are exposed to the browser
    And database, Privy, inference and provider secrets remain server-only

  @todo @P-9
  Scenario: The indexer runs on an always-on host separate from serverless functions
    Given the indexer must run continuously to stay near the chain tip
    When the platform is provisioned
    Then the indexer runs on an always-on host rather than ephemeral serverless functions
    And it writes to the same Neon database the read APIs consume

  @todo @P-9
  Scenario: Neon, Privy and inference are provisioned and wired before go-live
    Given the production environment is being prepared
    Then a Neon Postgres database is provisioned and migrated
    And Privy is configured with the production domain as an allowed origin
    And the inference service at infer.citrate.ai is reachable from the server runtime
    And each service has its credentials stored as production-scoped server-only secrets

  # ---------------------------------------------------------------------------
  # Go-live checklist
  # ---------------------------------------------------------------------------

  @todo @P-9 @gdpr @a11y
  Scenario: The go-live checklist passes before public launch
    Given CitrateScan is a candidate for public release on explorer.citrate.ai
    When the operator runs the go-live checklist
    Then the security headers and CSP are verified present and correctly scoped
    And robots.txt, the sitemap and SSR entity metadata are verified
    And rate limiting and the WAF are verified active on read APIs and "POST /api/chat"
    And the error tracking, structured logs and the health endpoints are verified live
    And the cookie-consent banner and the privacy, terms and cookie pages are verified reachable
    And the accessibility CI gate is green for every major screen
    And the always-on indexer is verified running and near the chain tip
    And the production secrets are confirmed scoped and server-only
    And only then is the launch approved
