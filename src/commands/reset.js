import { clearUserMemory, addTurn } from "../lib/memory.js";
import { buildMainKeyboard } from "../services/ui.js";

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
  bot.command("reset", async (ctx) => {
    ctx.session.store ??= {};
    ctx.session.store.currentMode = null;
    ctx.session.store.mergeQueue = [];
    ctx.session.store.mergeConfirmed = false;
    ctx.session.store.lastAction = "reset";

    await clearUserMemory({
      mongoUri: cfg.MONGODB_URI,
      platform: "telegram",
      userId: String(ctx.from?.id || ""),
      chatId: String(ctx.chat?.id || "")
    });

    const msg = "Reset done. Tell me: pdf to word, word to pdf, or merge pdfs.";
    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, cfg, msg);
  });
}
