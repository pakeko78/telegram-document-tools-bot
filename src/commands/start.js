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
  bot.command("start", async (ctx) => {
    const maxMb = String(cfg.MAX_FILE_MB || 20);

    const msg =
      "Hi. I can convert documents and merge PDFs.\n\n" +
      "1) Send a PDF to convert it to Word\n" +
      "2) Send a DOC or DOCX to convert it to PDF\n" +
      "3) To merge PDFs: say merge pdfs, then send PDFs in order, then press Merge now or send done\n\n" +
      "Note: file limit is about " +
      maxMb +
      " MB per file. Please send files as documents.";

    ctx.session.store ??= {};

    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, cfg, msg);

    ctx.session.store.lastAction = "start";
  });
}
