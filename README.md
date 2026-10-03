# RightMessage for Cloudflare

Flicker-free personalization in front of your existing website. A small Cloudflare Worker loads your published RightMessage plan, personalizes matching HTML with native `HTMLRewriter`, and leaves everything else to your origin and browser tag.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rightmessage/edge-cloudflare/tree/main/template)

## Requirements

- **Workers Paid is required.** The [Free plan caps CPU at 10 ms/request](https://developers.cloudflare.com/workers/platform/limits/). Personalization can use roughly **6–100 ms**, depending on document size and campaign complexity; measure your own pages. This is CPU, not network waiting time.
- Your site's DNS must be on Cloudflare and its origin record must be **proxied (orange cloud)**. Install this Worker on a **route**, not a Worker Custom Domain replacing your origin.
- **Cloudflare Snippets are not supported**: their [5 ms execution, 32 KB package, and 2–5 subrequest limits](https://developers.cloudflare.com/rules/snippets/) are too small.
- Keep your ordinary RightMessage browser tag snippet installed, and publish your campaigns. Your project ID is public, not an API secret.
- Node.js >=20 for the package; Node.js 22 or later is recommended for current Wrangler tooling.

## Install and quick start

Before the npm release, use the public GitHub package (its `prepare` script builds TypeScript):

```sh
npm install github:rightmessage/edge-cloudflare#v0.1.0
npm install --save-dev wrangler
```

After publication, the npm package is `@rightmessage/cloudflare`:

```sh
npm install @rightmessage/cloudflare
```

```ts
import { createRightMessageWorker } from '@rightmessage/cloudflare';

export default createRightMessageWorker({
  teamPid: '1213277114', // Replace with your own RightMessage project ID.
  // include: ['/', '/pricing', '/blog/*'],
  // exclude: ['/account/*'],
  // timeoutMs: 300,
});
```

Create the handler at module scope so its plan cache survives between requests. Options:

| Option | Behavior |
| --- | --- |
| `teamPid` | Required public RightMessage project ID. |
| `tagOrigin` | Defaults to `https://t.rightmessage.com`; HTTPS origin only. |
| `include` | Optional path globs. `*` matches any characters including `/`; omitted includes all paths; `[]` includes none. |
| `exclude` | Path globs that win over `include`. Query strings are not matched. |
| `timeoutMs` | Shared release + plan deadline starting before origin fetch; default 300 ms. |

### Ready-to-deploy template

Use the button above, or clone this repository and run:

```sh
cd template
npm install
# Edit wrangler.jsonc: team ID, route pattern, and zone_name.
npm run types
npm run deploy
```

The [template](template/) includes `wrangler.jsonc`, `RIGHTMESSAGE_TEAM_PID`, `example.com/*`, `zone_name`, and enabled observability. Replace both domain placeholders with your own zone/hostname and replace `YOUR_TEAM_PID`. For example, `www.example.com/*` can use `zone_name: example.com`. The DNS record must still point at your existing origin. No storage bindings or RightMessage credentials are needed.

**Same-zone fetching:** `fetch(request)` reaches your existing route's origin. The plan host `t.rightmessage.com` is in a different zone from a customer's site, so ordinary cross-zone `fetch` works. Cloudflare's restriction on [same-zone Worker-to-Worker subrequests](https://developers.cloudflare.com/workers/platform/limits/#worker-to-worker-subrequests) does not require a service binding for this deployment. If you customize `tagOrigin` to a same-zone route-backed Worker, that assumption no longer holds.

## How it works and fails open

The Worker starts the release/plan fetch **before** fetching the origin. The core checks the release and schema version, evaluates available request signals, and commits personalization only after the complete bounded transform succeeds. Each handler has an in-isolate release cache: fresh for 20 seconds, then stale-while-revalidate through `ctx.waitUntil`. The 300 ms request deadline does not stop a shared load from warming the cache.

Only HTML GET navigation responses are personalized. API paths (`/api`, `/api/*`), common asset extensions, `/assets/*`, `/_next/*`, RSC, prefetch requests, preview/editor query parameters, non-navigation requests, and configured exclusions bypass. HTML must be a successful UTF-8 document, at most 1 MiB input / 2 MiB output. Unsupported schema versions, unavailable plans, timeouts, malformed state, unsupported operations, and transform failures preserve the original HTML. The browser tag can still personalize later. An origin network failure is propagated: the Worker cannot recover HTML that the origin never returned. Platform CPU/memory termination cannot be caught; use Workers Paid and monitor limits.

No secret or server-side contact API access is required. The core reads published plan rules, query values, attribution/context cookies, user agent, date, and Cloudflare geography. It does not turn unsupported browser-only rules into false.

## Caching and debugging

- Applied responses have `Cache-Control: private, no-store` and CDN no-store headers. Do not override these with cache rules or cache personalized output in another proxy.
- Bypasses keep origin cache headers **unless a touch cookie changed**: cookie-only responses are also private/no-store to prevent visitor attribution leaking through a shared cache.
- The origin fetch can still use normal Cloudflare origin caching; the personalized result is never written to the Cache API.
- Inspect `x-rm-edge` with browser DevTools or `curl -i`. An applied page has `x-rm-edge: applied`. Typical bypass values are `no-actions`, `cookie-only`, `preview`, `rsc`, `request-method`, `api`, `asset`, `prefetch`, `not-navigation`, `excluded-path`, `origin-status`, `unsupported-charset`, `invalid-plan`, `plan-unavailable`, `plan-timeout`, `oversized`, and `transform-failed`. Non-HTML responses without an early routing exclusion are passed through untouched.
- Enabled Worker observability records core bypass diagnostics. Never add visitor cookies or response bodies to production logs.

## Browser tag and frameworks

**Do not remove the browser snippet.** Successful targets are stamped with `data-rm-personalized`, `data-rm-variant`, and `data-rm-edge-target`. An inert `RM_EDGE` receipt plus a revision-pinned loader hint lets the browser adopt the edge result without writing it again. Browser-only actions, analytics, later interaction, and receipt reconciliation remain the tag's responsibility.

Your tracking bootstrap must honor `meta[name="rm-edge-loader"]` so it loads the same published revision. Use the core's [drop-in revision-aware browser bootstrap and cloak CSS](https://github.com/rightmessage/edge#revision-aware-browser-bootstrap), replacing the existing loader rather than installing a second tag, and preserve your consent gate. Cloaking should reveal successful edge-personalized targets immediately rather than hiding them until the tag loads. On React sites use `suppressHydrationWarning` on the exact personalized text target, not an entire page. Client-side navigations do not fetch a new document through this Worker; use the [Next.js adapter](https://github.com/rightmessage/edge-nextjs) for route lifecycle integration. The [core package](https://github.com/rightmessage/edge) documents the receipt contract and supported operations.

## Rollback

Remove this Worker's route in Cloudflare or remove its route configuration and redeploy. Your existing origin and browser snippet continue serving the site. Do not delete the site's DNS record. There is no data migration to undo.

## Verify and contribute

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:live
```

Tests use Cloudflare's Vitest Workers pool and native `HTMLRewriter`. The live harness captures public homepage/pricing HTML, starts a local fixture origin and the **actual template with `wrangler dev`**, fetches the real public plan, checks applied/anonymous/fail-open behavior, and reports local CPU and latency. Captures are ignored, not shipped. Local CPU is not Cloudflare billing CPU; use Worker invocation logs after deployment for production measurements.

On Linux distributions where local `workerd` cannot locate system certificate roots, set `SSL_CERT_FILE` to your trusted system CA bundle before running the harness (for example, `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt npm run verify:live`). Do not disable TLS verification.

### Recorded local verification

On 2026-10-03, Node 22 / Wrangler 4.147.0, the real public release `51b52557fc249f2e25d816cee65b38b2f8ec92129d45ecede76351df0bd583fa` produced:

| Captured page | Bytes | `?biz=saas` | Anonymous | Warm median / p95 latency | Mean local process CPU |
| --- | ---: | --- | --- | ---: | ---: |
| `/` | 316,278 | `applied` | `bypass:cookie-only` | 22.70 / 28.18 ms | 22.5 ms |
| `/pricing` | 592,041 | `applied` | `bypass:cookie-only` | 26.22 / 34.92 ms | 26.0 ms |

The homepage heading became “Turn more of your existing traffic into paying customers.” Pricing became “Turn more visitors into trials, demos, and upgrades, for one fixed price per project.” Anonymous HTML remained byte-identical. Pointing the plan origin at an unreachable local HTTPS port produced `bypass:plan-unavailable` with byte-identical origin HTML on both pages (35.24 / 16.41 ms). The cold real-plan request applied in 243.11 ms.

Each warm row uses 20 sequential requests. CPU is Linux `/proc` user+system ticks for Wrangler's `workerd` children, including local runtime overhead; latency includes the local fixture origin and HTTP transport. These are reproducible local measurements, not production guarantees or Cloudflare billing CPU.

See [CONTRIBUTING](CONTRIBUTING.md) and [CHANGELOG](CHANGELOG.md). File reproducible bugs or feature requests at [GitHub Issues](https://github.com/rightmessage/edge-cloudflare/issues); strip visitor data and secrets. Report vulnerabilities privately to **security@rightmessage.com**.

MIT © 2026 RightMessage.
