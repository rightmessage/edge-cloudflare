# Changelog

## 0.2.0

- Depend on `@rightmessage/edge@^0.3.0`. The Worker now renders A/B tests and deployed winners, drawing each visitor's version as the browser tag does. The `^0.1.0` range never picked up edge 0.2, so campaigns with a holdback also start running at the edge with this release.
- Projects that use Wait for cookie consent need this version. Without `rm_consent=1` the Worker personalizes nothing, writes no cookie and responds `x-rm-edge: bypass:consent`. Workers on 0.1.x stop personalizing those projects until redeployed. `rm_exclude=1` renders version A of every test and writes no cookie.
- Remove the Worker's own `SUPPORTED_PLAN_VERSIONS` check. The core validates the plan version and still reports `bypass:invalid-plan`.
- The template depends on `@rightmessage/cloudflare@^0.2.0`.

## 0.1.1

- Depend on the published `@rightmessage/edge@^0.1.0` package instead of a Git tag.

## 0.1.0

- Initial Cloudflare Workers adapter and deployable route template.
- Concurrent, deadline-bounded plan loading, HTML-only routing, and fail-open personalization.
- Live-plan verification harness and Worker-runtime regression coverage.
