import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = new URL("../.fixtures/", import.meta.url);
const pages = new Map();
await mkdir(fixtures, { recursive: true });
for (const path of ["/", "/pricing"]) {
  const response = await fetch(`https://rightmessage.com${path}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  pages.set(path, html);
  await writeFile(new URL(path === "/" ? "home.html" : "pricing.html", fixtures), html);
}
const releaseResponse = await fetch("https://t.rightmessage.com/1213277114/release.json");
assert.equal(releaseResponse.status, 200);
const release = await releaseResponse.json();
console.log(JSON.stringify({ revision: release.revision, pages: [...pages].map(([path, html]) => ({ path, bytes: Buffer.byteLength(html) })) }));

const origin = createServer((request, response) => {
  const html = pages.get(new URL(request.url, "http://localhost").pathname);
  response.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" });
  response.end(html ?? "Not found");
});
origin.listen(0, "127.0.0.1");
await once(origin, "listening");
const upstream = `127.0.0.1:${origin.address().port}`;
let child;
let output = "";
async function stop() {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
}
async function start(tagOrigin) {
  await stop();
  output = "";
  child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "template/wrangler.jsonc", "--local", "--ip", "127.0.0.1", "--port", "8798", "--inspector-port", "0", "--local-upstream", upstream, "--upstream-protocol", "http", "--var", "RIGHTMESSAGE_TEAM_PID:1213277114", "--var", `RIGHTMESSAGE_TAG_ORIGIN:${tagOrigin}`], { cwd: root, env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Wrangler readiness timeout\n${output}`)), 30_000);
    const collect = chunk => {
      output += chunk;
      if (output.includes("Ready on")) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Wrangler exited ${code}\n${output}`)); });
  });
}
async function request(path) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:8798${path}`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
  const html = await response.text();
  return { response, html, latencyMs: performance.now() - started };
}
async function workerdCpu(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  let ticks = stat.includes("(workerd)") ? Number(fields[11]) + Number(fields[12]) : 0;
  const children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).trim();
  for (const childPid of children ? children.split(/\s+/) : []) ticks += await workerdCpu(childPid);
  return ticks;
}
const iterations = 20;
const ticksPerSecond = process.platform === "linux" ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" })) : null;
try {
  await start("https://t.rightmessage.com");
  const cold = await request("/?biz=saas");
  console.log(JSON.stringify({ scenario: "cold", edge: cold.response.headers.get("x-rm-edge"), latencyMs: +cold.latencyMs.toFixed(2) }));
  // A cold request can hit its 300 ms deadline; its shared load still warms the isolate.
  if (cold.response.headers.get("x-rm-edge") === "bypass:plan-timeout") await new Promise(resolve => setTimeout(resolve, 1500));
  for (const path of pages.keys()) {
    const matched = await request(`${path}?biz=saas`);
    assert.equal(matched.response.headers.get("x-rm-edge"), "applied", output);
    assert.equal(matched.response.headers.get("cache-control"), "private, no-store");
    assert.match(matched.html, /id="RM_EDGE"/);
    const heading = matched.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    const originalHeading = pages.get(path).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    assert.ok(heading, "Expected an h1 in captured page");
    assert.notEqual(heading, originalHeading, "Expected personalized heading copy");
    console.log(JSON.stringify({ scenario: "matched", path, edge: matched.response.headers.get("x-rm-edge"), heading: heading.replace(/<[^>]+>/g, ""), latencyMs: +matched.latencyMs.toFixed(2) }));
    const anonymous = await request(path);
    assert.match(anonymous.response.headers.get("x-rm-edge"), /^bypass:/);
    assert.equal(anonymous.html, pages.get(path));
    assert.equal(anonymous.response.headers.get("cache-control"), anonymous.response.headers.has("set-cookie") ? "private, no-store" : "public, max-age=60");
    console.log(JSON.stringify({ scenario: "anonymous", path, edge: anonymous.response.headers.get("x-rm-edge"), byteIdentical: true }));
    const beforeCpu = ticksPerSecond ? await workerdCpu(child.pid) : null;
    const latencies = [];
    for (let i = 0; i < iterations; i++) {
      const result = await request(`${path}?biz=saas`);
      assert.equal(result.response.headers.get("x-rm-edge"), "applied");
      latencies.push(result.latencyMs);
    }
    const afterCpu = ticksPerSecond ? await workerdCpu(child.pid) : null;
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ scenario: "warm-benchmark", path, iterations, latencyMedianMs: +latencies[Math.floor(iterations / 2)].toFixed(2), latencyP95Ms: +latencies[Math.ceil(iterations * 0.95) - 1].toFixed(2), workerdProcessCpuMeanMs: ticksPerSecond ? +((afterCpu - beforeCpu) / ticksPerSecond * 1000 / iterations).toFixed(2) : null, cpuMethod: "Linux /proc user+system ticks for Wrangler's workerd child processes; includes local runtime overhead, not billing CPU" }));
  }
  await start("https://127.0.0.1:1");
  for (const path of pages.keys()) {
    const failed = await request(`${path}?biz=saas`);
    assert.match(failed.response.headers.get("x-rm-edge"), /^bypass:plan-(unavailable|timeout)$/);
    assert.equal(failed.html, pages.get(path));
    assert.equal(failed.response.headers.get("cache-control"), "public, max-age=60");
    console.log(JSON.stringify({ scenario: "unreachable-plan-host", path, edge: failed.response.headers.get("x-rm-edge"), byteIdentical: true, latencyMs: +failed.latencyMs.toFixed(2) }));
  }
} finally {
  await stop();
  origin.closeAllConnections();
  await new Promise(resolve => origin.close(resolve));
}
