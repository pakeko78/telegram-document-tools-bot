import "dotenv/config";

import process from "node:process";

function safeErr(e) {
  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    String(e)
  );
}

process.on("unhandledRejection", (r) => {
  console.error("[process] unhandledRejection", { err: safeErr(r) });
  process.exit(1);
});

process.on("uncaughtException", (e) => {
  console.error("[process] uncaughtException", { err: safeErr(e) });
  process.exit(1);
});

async function boot() {
  console.log("[boot] starting", {
    tokenSet: !!process.env.TELEGRAM_BOT_TOKEN,
    mongoSet: !!process.env.MONGODB_URI,
    aiEndpointSet: !!process.env.COOKMYBOTS_AI_ENDPOINT,
    aiKeySet: !!process.env.COOKMYBOTS_AI_KEY
  });

  try {
    const { cfg } = await import("./lib/config.js");

    if (!cfg.TELEGRAM_BOT_TOKEN) {
      console.error(
        "TELEGRAM_BOT_TOKEN is required. Set it in env and redeploy."
      );
      process.exit(1);
    }

    const { createBot } = await import("./bot.js");
    const bot = await createBot(cfg);

    await bot.api.deleteWebhook({ drop_pending_updates: true });

    const { run } = await import("@grammyjs/runner");

    let backoffMs = 2000;
    const maxBackoffMs = 20000;

    while (true) {
      try {
        console.log("[polling] starting runner", { concurrency: cfg.CONCURRENCY });
        await run(bot, { concurrency: cfg.CONCURRENCY });
        console.warn("[polling] runner stopped unexpectedly; restarting");
      } catch (e) {
        const msg = safeErr(e);
        const code = e?.error_code || e?.code;

        if (code === 409 || String(msg).includes("409")) {
          console.warn("[polling] 409 conflict; backing off", { backoffMs });
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(maxBackoffMs, Math.floor(backoffMs * 2.5));
          continue;
        }

        console.error("[polling] runner error", { err: msg });
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(maxBackoffMs, Math.floor(backoffMs * 2.5));
      }
    }
  } catch (e) {
    console.error("[boot] failed", { err: safeErr(e), code: e?.code });
    if (e?.code === "ERR_MODULE_NOT_FOUND") {
      console.error(
        "A required module was not found. Check that all src/ files exist and imports include .js extensions."
      );
    }
    process.exit(1);
  }
}

boot();
