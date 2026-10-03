# Contributing

Use Node.js 22 or later for development. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Tests run in the real Workers runtime with outbound fetch mocks. Run `npm run verify:live` for a local Wrangler end-to-end check against the public plan (network access required). It captures public HTML into ignored `.fixtures/`; never commit visitor data or cookies.

Open an issue before proposing broad API changes. Keep changes small, add behavioral coverage, and update the changelog. Security issues go to security@rightmessage.com.

Releases use the `Release` GitHub Actions workflow. Publishing is disabled unless the repository variable `NPM_PUBLISH_ENABLED` is `true`; leave it unset until npm is ready. A maintainer must bootstrap the npm organization/package, configure a trusted publisher for `rightmessage/edge-cloudflare`, workflow `release.yml`, environment `npm` (or configure the `NPM_TOKEN` fallback), then enable the variable and manually dispatch the workflow against the release tag. The workflow uses npm >=11.5, OIDC and provenance. Do not dispatch it just to test setup.
