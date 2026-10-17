import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createRightMessageWorker } from "../src/index.js";
import type { RightMessageWorkerOptions } from "../src/index.js";

const teamPid = "1213277114";
const revision = "a".repeat(64);
const html = "<html><head></head><body><h1>Generic teams</h1></body></html>";
const release = { version: 1, teamPid, revision, planUrl: `https://t.rightmessage.com/${teamPid}/revisions/${revision}/plan.json`, loaderUrl: `https://t.rightmessage.com/${teamPid}.js?revision=${revision}` };
const plan = {
  version: 1, teamPid, queryNames: ["biz"],
  dimensions: [{ id: "business", isMultiWinning: false, segments: [{ id: "saas" }], signals: [{ indicates: "saas", definition: { $source: "query", query: "biz", occurrence: "last touch", operator: "equals", value: "saas" }, edge: { supported: true } }] }],
  campaigns: [{ id: "campaign", is_active: true, variants: [{ id: "variant", rules: { all: [{ segment: "saas" }] }, actions: [{ id: "action", actionId: "action", campaignId: "campaign", variantId: "variant", type: "MODIFY_ELEMENT", page: [{ domain: "*", path: "/*" }], selector: "h1", modifications: { text: "Software teams" }, edge: { supported: true, operations: ["text"], deferredOperations: [] } }] }] }],
};
const tested = (version: string, text: string) => ({ id: "tested", actionId: "tested", campaignId: "cpn_opCBD8W3", variantId: "var_saas", versions: [version], page: [{ domain: "*", path: "/*" }], selector: "h1", modifications: { text }, edge: { supported: false, reason: "campaign-test", operations: ["text"], deferredOperations: [] } });
const testedPlan = {
  version: 1, teamPid, queryNames: [], dimensions: [],
  campaigns: [{ id: "cpn_opCBD8W3", is_active: true, variants: [{ id: "var_saas", rules: true, abTest: { id: "abt_AbCdEf012345", state: "running", run: "abr_AbCdEf0123456789", weights: { A: 50, B: 50 } }, actions: [tested("A", "Version A teams"), tested("B", "Version B teams")] }] }],
};

const routes = new Map<string, { method: string; respond: () => Response | Promise<Response> }>();
beforeEach(() => {
  routes.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const request = new Request(input);
    const route = routes.get(request.url);
    if (!route) throw new Error(`Unexpected network request: ${request.url}`);
    routes.delete(request.url);
    expect(request.method).toBe(route.method);
    return route.respond();
  }));
});
afterEach(() => {
  expect([...routes.keys()]).toEqual([]);
  vi.unstubAllGlobals();
});

function origin(path: string, method = "GET", contentType = "text/html; charset=utf-8") {
  routes.set(`https://site.example${path}`, { method, respond: () => new Response(html, { headers: { "content-type": contentType, "cache-control": "public, max-age=60", etag: '"origin"' } }) });
}
function mockPlan(overrides: object = {}) {
  routes.set(`https://t.rightmessage.com/${teamPid}/release.json`, { method: "GET", respond: () => Response.json(release) });
  routes.set(release.planUrl, { method: "GET", respond: () => Response.json({ ...plan, ...overrides }) });
}
async function run(path: string, options: Partial<RightMessageWorkerOptions> = {}, init: RequestInit = {}) {
  const worker = createRightMessageWorker({ teamPid, ...options });
  const ctx = createExecutionContext();
  const response = await worker.fetch!(new Request(`https://site.example${path}`, init), {}, ctx);
  const body = await response.text();
  await waitOnExecutionContext(ctx);
  return { response, body };
}

test("personalizes matching HTML and prevents shared caching", async () => {
  origin("/?biz=saas"); mockPlan();
  const { response, body } = await run("/?biz=saas");
  expect(response.headers.get("x-rm-edge")).toBe("applied");
  expect(body).toContain(">Software teams</h1>");
  expect(body).toContain('id="RM_EDGE"');
  expect(body).toContain('data-rm-personalized="true"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("etag")).toBeNull();
});

test("anonymous HTML stays byte-identical and caches only when attribution is unchanged", async () => {
  origin("/"); mockPlan();
  const { response, body } = await run("/");
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBe("bypass:cookie-only");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  origin("/"); mockPlan();
  const returning = await run("/", {}, { headers: { cookie } });
  expect(returning.body).toBe(html);
  expect(returning.response.headers.get("x-rm-edge")).toBe("bypass:no-actions");
  expect(returning.response.headers.get("cache-control")).toBe("public, max-age=60");
});

const excluded: [string, RequestInit, string][] = [
  ["/", { method: "POST" }, "request-method"],
  ["/", { headers: { rsc: "1" } }, "rsc"],
  ["/?preview", {}, "preview"],
  ["/?rmpreview=1", {}, "preview"],
  ["/?__rm_test=1", {}, "preview"],
  ["/?rmeditor=1", {}, "preview"],
  ["/api", {}, "api"], ["/api/users", {}, "api"],
  ["/app.js", {}, "asset"], ["/_next/data/build/page", {}, "asset"],
  ["/", { headers: { "next-router-prefetch": "1" } }, "prefetch"],
  ["/", { headers: { "sec-purpose": "prefetch;prerender" } }, "prefetch"],
  ["/", { headers: { purpose: "prefetch" } }, "prefetch"],
  ["/", { headers: { "sec-fetch-dest": "image" } }, "not-navigation"],
  ["/", { headers: { accept: "application/json" } }, "not-navigation"],
];
test.each(excluded)("bypasses %s %j without fetching a plan", async (path, init, reason) => {
  origin(path, init.method);
  const { response, body } = await run(path, {}, init);
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBe(`bypass:${reason}`);
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
});

test("exclusions win and globs match paths rather than query strings", async () => {
  origin("/account/settings?biz=saas");
  const result = await run("/account/settings?biz=saas", { include: ["/*"], exclude: ["/account/*"] });
  expect(result.response.headers.get("x-rm-edge")).toBe("bypass:excluded-path");
  expect(result.body).toBe(html);
});

test("an empty include set excludes every path", async () => {
  origin("/");
  expect((await run("/", { include: [] })).response.headers.get("x-rm-edge")).toBe("bypass:excluded-path");
});

test("unknown plan schemas fail open", async () => {
  origin("/?biz=saas"); mockPlan({ version: 999 });
  const { response, body } = await run("/?biz=saas");
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBe("bypass:invalid-plan");
});

test("a tested campaign renders the version its unit draws", async () => {
  const drawn: (string | undefined)[][] = [];
  for (const unit of ["AAAAAAAAAAAAAAAAAAAAAA", "zZ9_-QkLmNoPqRsTuVwXyA"]) {
    origin("/"); mockPlan(testedPlan);
    const { response, body } = await run("/", {}, { headers: { cookie: `__Host-rm_touch=%7B%22v%22%3A1%2C%22q%22%3A%7B%7D%2C%22r%22%3A%22%22%2C%22u%22%3A%22${unit}%22%7D` } });
    drawn.push([unit, response.headers.get("x-rm-edge") ?? undefined, body.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1], body.match(/"versions":\["([A-D])"\]/)?.[1]]);
  }
  expect(drawn).toEqual([
    ["AAAAAAAAAAAAAAAAAAAAAA", "applied", "Version A teams", "A"],
    ["zZ9_-QkLmNoPqRsTuVwXyA", "applied", "Version B teams", "B"],
  ]);
});

test("a consent-required plan without rm_consent=1 bypasses without a cookie", async () => {
  origin("/?biz=saas"); mockPlan({ version: 2, consent: "required" });
  const { response, body } = await run("/?biz=saas");
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBe("bypass:consent");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");

  origin("/?biz=saas"); mockPlan({ version: 2, consent: "required" });
  const consented = await run("/?biz=saas", {}, { headers: { cookie: "rm_consent=1" } });
  expect(consented.response.headers.get("x-rm-edge")).toBe("applied");
  expect(consented.body).toContain(">Software teams</h1>");
});

test("an unreachable plan host preserves origin status, body, and caching", async () => {
  origin("/?biz=saas");
  routes.set(`https://t.rightmessage.com/${teamPid}/release.json`, { method: "GET", respond: () => { throw new Error("unreachable"); } });
  const { response, body } = await run("/?biz=saas");
  expect(response.status).toBe(200);
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBe("bypass:plan-unavailable");
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
});

test("a slow release observes the configured deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  origin("/?biz=saas");
  routes.set(`https://t.rightmessage.com/${teamPid}/release.json`, { method: "GET", respond: async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 80);
    await promise;
    return new Response("unavailable", { status: 503 });
  } });
  try {
    const pending = run("/?biz=saas", { timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(81);
    const { response, body } = await pending;
    expect(body).toBe(html);
    expect(response.headers.get("x-rm-edge")).toBe("bypass:plan-timeout");
  } finally {
    vi.useRealTimers();
  }
});

test("non-HTML bodies are not transformed even when a campaign matches", async () => {
  origin("/download?biz=saas", "GET", "application/octet-stream");
  mockPlan();
  const { response, body } = await run("/download?biz=saas");
  expect(body).toBe(html);
  expect(response.headers.get("x-rm-edge")).toBeNull();
  expect(response.headers.get("etag")).toBe('"origin"');
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
});

test("included paths still personalize and query strings do not affect glob matching", async () => {
  origin("/pricing?biz=saas"); mockPlan();
  const { response, body } = await run("/pricing?biz=saas", { include: ["/pricing"] });
  expect(response.headers.get("x-rm-edge")).toBe("applied");
  expect(body).toContain(">Software teams</h1>");
});
