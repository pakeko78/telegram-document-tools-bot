import { buildMainKeyboard } from "../services/ui.js";
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
  bot.command("help", async (ctx) => {
    const msg =
      "Commands:\n" +
      "/start Start\n" +
      "/help Help\n" +
      "/status Show current mode and merge queue\n" +
      "/reset Clear workflow state and memory\n\n" +
      "Examples:\n" +
      "1) pdf to word then send a PDF\n" +
      "2) word to pdf then send a DOCX\n" +
      "3) merge pdfs then send PDFs, then done";

    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, cfg, msg);
  });
}
