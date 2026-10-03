import {
  createPlanCache,
  personalizeResponse,
  requestBypassReason,
  startPlanLoad,
  SUPPORTED_PLAN_VERSIONS,
} from "@rightmessage/edge";
import type { PlanLoad } from "@rightmessage/edge";

export interface RightMessageWorkerOptions {
  teamPid: string;
  tagOrigin?: string;
  /** Path globs; * matches any characters, including /. */
  include?: readonly string[];
  /** Exclusions win over inclusions. */
  exclude?: readonly string[];
  /** Release and plan deadline, starting before the origin fetch. Default: 300 ms. */
  timeoutMs?: number;
}

const compile = (patterns: readonly string[]) => patterns.map(pattern =>
  new RegExp(`^${pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`),
);
const assets = /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|otf|pdf|png|svg|txt|webm|webp|woff2?|xml|zip)$/i;

function bypass(origin: Response, reason: string): Response {
  const headers = new Headers(origin.headers);
  headers.set("x-rm-edge", `bypass:${reason}`);
  return new Response(origin.body, { status: origin.status, statusText: origin.statusText, headers });
}

/** Creates one handler/cache per isolate. Install on a route in front of an existing origin. */
export function createRightMessageWorker(options: RightMessageWorkerOptions): ExportedHandler {
  const config = { teamPid: options.teamPid, tagOrigin: options.tagOrigin, enabled: true };
  const include = options.include ? compile(options.include) : null;
  const exclude = compile(options.exclude ?? []);
  const planCache = createPlanCache();
  return {
    async fetch(request, _env, ctx) {
      let reason: string | null = null;
      let planLoad: PlanLoad | undefined;
      try {
        const url = new URL(request.url);
        reason = requestBypassReason(request, config);
        if (!reason && (request.headers.has("next-router-prefetch") || /prefetch/i.test(`${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`))) reason = "prefetch";
        if (!reason && (url.pathname === "/api" || url.pathname.startsWith("/api/"))) reason = "api";
        if (!reason && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/assets/") || assets.test(url.pathname))) reason = "asset";
        const destination = request.headers.get("sec-fetch-dest");
        const accept = request.headers.get("accept");
        if (!reason && ((destination && destination !== "document" && destination !== "iframe") || (accept && !accept.includes("text/html") && !accept.includes("*/*")))) reason = "not-navigation";
        if (!reason && (exclude.some(pattern => pattern.test(url.pathname)) || (include && !include.some(pattern => pattern.test(url.pathname))))) reason = "excluded-path";
        if (!reason) planLoad = startPlanLoad(request, config, { fetch, planCache, planTimeoutMs: options.timeoutMs }, ctx);
      } catch {
        reason = "invalid-plan";
      }

      let origin: Response;
      try {
        origin = await fetch(request);
      } catch (error) {
        planLoad?.abort();
        throw error;
      }
      if (reason) return bypass(origin, reason);
      if (!origin.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        planLoad?.abort();
        return origin;
      }
      if (!planLoad) return bypass(origin, "plan-unavailable");
      try {
        const outcome = await planLoad.promise;
        if (outcome.loaded && !SUPPORTED_PLAN_VERSIONS.includes(outcome.loaded.plan.version)) {
          planLoad.abort();
          return bypass(origin, "invalid-plan");
        }
        return await personalizeResponse(request, origin, planLoad, { HTMLRewriter });
      } catch {
        planLoad.abort();
        return bypass(origin, "transform-failed");
      }
    },
  };
}
