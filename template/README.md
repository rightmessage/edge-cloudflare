# Deploy RightMessage on Cloudflare

1. Use Workers Paid and a proxied (orange-cloud) DNS record pointing to your existing origin.
2. Set `RIGHTMESSAGE_TEAM_PID` in `wrangler.jsonc` to your public project ID from RightMessage's snippet.
3. Replace **both** `example.com/*` and `zone_name` with your domain. Use a Worker **route**, not a Custom Domain: the origin must remain your existing site.
4. Run `npm install`, `npm run types`, then `npm run deploy`. Wrangler prompts you to sign in if needed. No RightMessage API secret is required.
5. Keep the browser tag snippet installed. Test a campaign URL using `curl -i 'https://your-domain/?your-segment=value'` and inspect `x-rm-edge`.

Before the npm release this template installs the public GitHub package; its prepare script compiles TypeScript. After npm publication you may replace that dependency with `@rightmessage/cloudflare@^0.1.0`.

The handler is cached once per isolate, preserving its 20-second release cache. Optional `include`, `exclude`, `tagOrigin`, and `timeoutMs` settings go in `createRightMessageWorker`.

See the [package guide](https://github.com/rightmessage/edge-cloudflare#readme) for caching, browser adoption, limits, troubleshooting, and rollback. Remove the Worker route to roll back; do not remove your origin DNS record or browser tag.
