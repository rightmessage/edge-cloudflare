import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-08-15", compatibilityFlags: ["nodejs_compat"] } })],
  test: { include: ["test/**/*.test.ts"] },
});
