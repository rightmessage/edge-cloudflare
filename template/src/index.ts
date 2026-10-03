import { createRightMessageWorker } from "@rightmessage/cloudflare";

let worker: ExportedHandler<Env> | undefined;
export default {
  fetch(request, env, ctx) {
    worker ??= createRightMessageWorker({
      teamPid: env.RIGHTMESSAGE_TEAM_PID,
      tagOrigin: env.RIGHTMESSAGE_TAG_ORIGIN,
    });
    return worker.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
