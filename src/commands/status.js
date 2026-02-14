import { addTurn } from "../lib/memory.js";

function clampText(t, max = 4000) {
  const s = String(t || "");
  return s.length > max ? s.slice(0, max) : s;
}

async function saveAssistantTurn(ctx, cfg, text) {
  await addTurn({
    mongoUri: cfg.MONGODB_URI,
    platform: "telegram",
    userId: String(ctx.from?.id || ""),
    chatId: String(ctx.chat?.id || ""),
    role: "assistant",
    text: clampText(text)
  });
}

export default async function register(bot, cfg) {
  bot.command("status", async (ctx) => {
    ctx.session.store ??= {};
    ctx.session.store.mergeQueue ??= [];

    const mode = ctx.session.store.currentMode;
    const queued = ctx.session.store.mergeQueue.length;
    const last = ctx.session.store.lastAction || "";

    const msg =
      "Mode: " +
      String(mode || "none") +
      "\nQueued PDFs: " +
      String(queued) +
      (last ? "\nLast: " + last : "");

    await ctx.reply(msg);
    await saveAssistantTurn(ctx, cfg, msg);
  });
}
