import { Bot, session } from "grammy";

import { registerCommands } from "./commands/loader.js";
import { cfg as readCfg } from "./lib/config.js";
import { safeErr } from "./lib/safeErr.js";
import {
  addTurn,
  getRecentTurns,
  clearUserMemory
} from "./lib/memory.js";
import { aiChat } from "./lib/ai.js";
import { downloadTelegramDocument } from "./services/telegramFiles.js";
import { convertDocument } from "./services/conversionService.js";
import { mergePdfs } from "./services/pdfMergeService.js";
import {
  buildMainKeyboard,
  buildMergeKeyboard,
  isText
} from "./services/ui.js";

function initialSession() {
  return {
    store: {
      currentMode: null,
      mergeQueue: [],
      lastAction: "",
      lastPromptMsgId: null
    }
  };
}

function isAdmin(ctx, cfg) {
  const adminId = String(cfg.ADMIN_TELEGRAM_USER_ID || "").trim();
  if (!adminId) return false;
  return String(ctx.from?.id || "") === adminId;
}

function clampText(t, max = 4000) {
  const s = String(t || "");
  return s.length > max ? s.slice(0, max) : s;
}

function inferModeFromFilename(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf_to_word";
  if (n.endsWith(".doc") || n.endsWith(".docx")) return "word_to_pdf";
  return null;
}

async function shouldHandleGroupMessage(ctx) {
  const chatType = ctx.chat?.type || "private";
  if (chatType === "private") return true;

  const botUsername = ctx.me?.username || ctx.botInfo?.username || "";
  if (!botUsername) return false;

  const msg = ctx.message;
  if (!msg) return false;

  const rawText = msg.text || "";
  const replyTo = msg.reply_to_message;
  const isReplyToBot =
    !!replyTo?.from?.is_bot &&
    String(replyTo?.from?.username || "").toLowerCase() ===
      String(botUsername).toLowerCase();

  const ents = Array.isArray(msg.entities) ? msg.entities : [];
  const isMentioned = ents.some((e) => {
    if (!e || e.type !== "mention") return false;
    const s = rawText.slice(e.offset, e.offset + e.length);
    return s.toLowerCase() === ("@" + botUsername.toLowerCase());
  });

  return isReplyToBot || isMentioned;
}

async function saveUserTurn(ctx, text) {
  const userId = String(ctx.from?.id || "");
  const chatId = String(ctx.chat?.id || "");
  await addTurn({
    mongoUri: readCfg.MONGODB_URI,
    platform: "telegram",
    userId,
    chatId,
    role: "user",
    text: clampText(text)
  });
}

async function saveAssistantTurn(ctx, text) {
  const userId = String(ctx.from?.id || "");
  const chatId = String(ctx.chat?.id || "");
  await addTurn({
    mongoUri: readCfg.MONGODB_URI,
    platform: "telegram",
    userId,
    chatId,
    role: "assistant",
    text: clampText(text)
  });
}

async function aiInterpretText(ctx, text) {
  const userId = String(ctx.from?.id || "");
  const chatId = String(ctx.chat?.id || "");

  const history = await getRecentTurns({
    mongoUri: readCfg.MONGODB_URI,
    platform: "telegram",
    userId,
    chatId,
    limit: 16
  });

  const sys =
    "You are a Telegram document utility bot. Your job is to interpret the user's intent and respond with a tiny JSON object only. " +
    "Allowed intents: set_mode_pdf_to_word, set_mode_word_to_pdf, set_mode_merge_pdfs, merge_done, merge_remove_last, merge_clear, status, reset, help, unknown. " +
    "Return JSON with keys: intent (string), reply (string). Keep reply short and friendly. Do not use markdown.";

  const messages = [
    { role: "system", content: sys },
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: text }
  ];

  const out = await aiChat({
    messages,
    meta: {
      platform: "telegram",
      feature: "intent"
    }
  });

  const raw = String(out || "").trim();
  try {
    const json = JSON.parse(raw);
    return {
      intent: String(json.intent || "unknown"),
      reply: String(json.reply || "")
    };
  } catch {
    return {
      intent: "unknown",
      reply: ""
    };
  }
}

async function handleDocument(ctx, cfg) {
  ctx.session.store ??= {};
  ctx.session.store.mergeQueue ??= [];

  const doc = ctx.message?.document;
  if (!doc) return;

  const fileName = doc.file_name || "file";
  const inferred = inferModeFromFilename(fileName);

  const mode = ctx.session.store.currentMode || inferred;
  if (!mode) {
    const msg =
      "I can work with PDF and Word files. Tell me what you want first: pdf to word, word to pdf, or merge pdfs.";
    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, msg);
    ctx.session.store.lastAction = "asked_for_mode";
    return;
  }

  const maxBytes = Math.max(1, Number(cfg.MAX_FILE_MB || 20)) * 1024 * 1024;
  const sizeBytes = Number(doc.file_size || 0);

  if (sizeBytes && sizeBytes > maxBytes) {
    const msg =
      "That file is too large for this bot right now. Please send a smaller file (limit is " +
      String(cfg.MAX_FILE_MB || 20) +
      " MB).";
    await ctx.reply(msg);
    await saveAssistantTurn(ctx, msg);
    ctx.session.store.lastAction = "rejected_too_large";
    return;
  }

  if (mode === "merge_pdfs") {
    if (!String(fileName).toLowerCase().endsWith(".pdf")) {
      const msg = "Merge mode only accepts PDFs. Please send a PDF document file.";
      await ctx.reply(msg);
      await saveAssistantTurn(ctx, msg);
      return;
    }

    ctx.session.store.mergeQueue.push({
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      fileName,
      sizeBytes,
      addedAt: new Date().toISOString()
    });

    ctx.session.store.currentMode = "merge_pdfs";
    ctx.session.store.lastAction = "merge_added";

    const n = ctx.session.store.mergeQueue.length;
    const msg = "Added. Now queued: " + n + ". Send more PDFs, or press Merge now / send done.";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
    return;
  }

  if (mode === "pdf_to_word") {
    if (!String(fileName).toLowerCase().endsWith(".pdf")) {
      const msg = "For PDF to Word, please send a PDF as a document.";
      await ctx.reply(msg);
      await saveAssistantTurn(ctx, msg);
      return;
    }

    const receivedMsg = "Got it. Converting your PDF to Word now.";
    await ctx.reply(receivedMsg);
    await saveAssistantTurn(ctx, receivedMsg);

    const progress = await ctx.reply("Downloading file...");

    try {
      console.log("[convert] start", {
        mode,
        chatId: String(ctx.chat?.id || ""),
        userId: String(ctx.from?.id || ""),
        fileName,
        sizeBytes
      });

      const input = await downloadTelegramDocument(ctx.api, cfg.TELEGRAM_BOT_TOKEN, doc, {
        maxBytes
      });

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Processing...");

      const out = await convertDocument({
        direction: "pdf_to_word",
        inputBuffer: input.buffer,
        inputFilename: fileName
      });

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Uploading...");

      await ctx.api.sendDocument(
        ctx.chat.id,
        out.inputFile,
        {
          filename: out.outputFilename
        }
      );

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Done.");

      ctx.session.store.lastAction = "converted_pdf_to_word";

      console.log("[convert] success", {
        mode,
        outputFilename: out.outputFilename,
        outBytes: out.outputBytes
      });
    } catch (e) {
      console.error("[convert] failure", { err: safeErr(e), mode });
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          progress.message_id,
          "Sorry, that conversion failed. Please try again or send a smaller/cleaner PDF."
        );
      } catch {}

      const helpMsg = await aiChat({
        messages: [
          {
            role: "system",
            content:
              "You are a helpful Telegram bot. Write a short, friendly error message (1-2 lines) suggesting one next step. No markdown."
          },
          { role: "user", content: "PDF to Word conversion failed. Error: " + safeErr(e) }
        ],
        meta: { platform: "telegram", feature: "error_copy" }
      }).catch(() => "Sorry, that conversion failed. Please retry with a smaller file.");

      await ctx.reply(String(helpMsg || "Sorry, that conversion failed. Please retry."));
      await saveAssistantTurn(ctx, String(helpMsg || "Sorry, that conversion failed."));
      ctx.session.store.lastAction = "convert_failed";
    }

    return;
  }

  if (mode === "word_to_pdf") {
    const lower = String(fileName).toLowerCase();
    if (!(lower.endsWith(".doc") || lower.endsWith(".docx"))) {
      const msg = "For Word to PDF, please send a .doc or .docx as a document.";
      await ctx.reply(msg);
      await saveAssistantTurn(ctx, msg);
      return;
    }

    const receivedMsg = "Got it. Converting your Word document to PDF now.";
    await ctx.reply(receivedMsg);
    await saveAssistantTurn(ctx, receivedMsg);

    const progress = await ctx.reply("Downloading file...");

    try {
      console.log("[convert] start", {
        mode,
        chatId: String(ctx.chat?.id || ""),
        userId: String(ctx.from?.id || ""),
        fileName,
        sizeBytes
      });

      const input = await downloadTelegramDocument(ctx.api, cfg.TELEGRAM_BOT_TOKEN, doc, {
        maxBytes
      });

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Processing...");

      const out = await convertDocument({
        direction: "word_to_pdf",
        inputBuffer: input.buffer,
        inputFilename: fileName
      });

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Uploading...");

      await ctx.api.sendDocument(ctx.chat.id, out.inputFile, {
        filename: out.outputFilename
      });

      await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Done.");

      ctx.session.store.lastAction = "converted_word_to_pdf";

      console.log("[convert] success", {
        mode,
        outputFilename: out.outputFilename,
        outBytes: out.outputBytes
      });
    } catch (e) {
      console.error("[convert] failure", { err: safeErr(e), mode });
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          progress.message_id,
          "Sorry, that conversion failed. Please try again or send a simpler/smaller DOCX."
        );
      } catch {}

      const helpMsg = await aiChat({
        messages: [
          {
            role: "system",
            content:
              "You are a helpful Telegram bot. Write a short, friendly error message (1-2 lines) suggesting one next step. No markdown."
          },
          { role: "user", content: "Word to PDF conversion failed. Error: " + safeErr(e) }
        ],
        meta: { platform: "telegram", feature: "error_copy" }
      }).catch(() => "Sorry, that conversion failed. Please retry with a smaller file.");

      await ctx.reply(String(helpMsg || "Sorry, that conversion failed. Please retry."));
      await saveAssistantTurn(ctx, String(helpMsg || "Sorry, that conversion failed."));
      ctx.session.store.lastAction = "convert_failed";
    }

    return;
  }
}

async function doMergeNow(ctx, cfg, requireConfirm = true) {
  ctx.session.store ??= {};
  ctx.session.store.mergeQueue ??= [];

  const q = ctx.session.store.mergeQueue;
  if (!q.length) {
    const msg = "No PDFs queued yet. Send PDFs first (as documents).";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
    return;
  }

  if (q.length === 1) {
    const msg = "You only have 1 PDF queued. Send at least 2 PDFs to merge.";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
    return;
  }

  if (requireConfirm && !ctx.session.store.mergeConfirmed) {
    ctx.session.store.mergeConfirmed = true;
    const msg = "You have " + q.length + " PDFs queued. Reply with yes to confirm merging, or send clear to start over.";
    await ctx.reply(msg);
    await saveAssistantTurn(ctx, msg);
    ctx.session.store.lastAction = "merge_asked_confirm";
    return;
  }

  ctx.session.store.mergeConfirmed = false;

  const maxBytes = Math.max(1, Number(cfg.MAX_FILE_MB || 20)) * 1024 * 1024;

  const progress = await ctx.reply("Downloading PDFs...");

  try {
    console.log("[merge] start", {
      chatId: String(ctx.chat?.id || ""),
      userId: String(ctx.from?.id || ""),
      count: q.length
    });

    const buffers = [];
    for (const item of q) {
      const fakeDoc = {
        file_id: item.fileId,
        file_unique_id: item.fileUniqueId,
        file_name: item.fileName,
        file_size: item.sizeBytes
      };
      const input = await downloadTelegramDocument(ctx.api, cfg.TELEGRAM_BOT_TOKEN, fakeDoc, {
        maxBytes
      });
      buffers.push({ buffer: input.buffer, fileName: item.fileName });
    }

    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Merging...");

    const merged = await mergePdfs(buffers.map((b) => b.buffer));

    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Uploading...");

    const outName = "merged.pdf";
    await ctx.api.sendDocument(ctx.chat.id, merged.inputFile, {
      filename: outName
    });

    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, "Done.");

    ctx.session.store.mergeQueue = [];
    ctx.session.store.currentMode = null;
    ctx.session.store.lastAction = "merged_pdfs";

    console.log("[merge] success", { outBytes: merged.outputBytes });
  } catch (e) {
    console.error("[merge] failure", { err: safeErr(e) });
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        progress.message_id,
        "Sorry, merging failed. Please try again, or send smaller PDFs."
      );
    } catch {}

    const helpMsg = await aiChat({
      messages: [
        {
          role: "system",
          content:
            "You are a helpful Telegram bot. Write a short, friendly error message (1-2 lines) suggesting one next step. No markdown."
        },
        { role: "user", content: "PDF merge failed. Error: " + safeErr(e) }
      ],
      meta: { platform: "telegram", feature: "error_copy" }
    }).catch(() => "Sorry, merging failed. Please retry with smaller PDFs.");

    await ctx.reply(String(helpMsg || "Sorry, merging failed. Please retry."));
    await saveAssistantTurn(ctx, String(helpMsg || "Sorry, merging failed."));
    ctx.session.store.lastAction = "merge_failed";
  }
}

export async function createBot(cfg) {
  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);

  bot.use(
    session({
      initial: initialSession
    })
  );

  bot.catch(async (err) => {
    console.error("[bot] handler error", {
      err: safeErr(err?.error || err),
      chatId: String(err?.ctx?.chat?.id || ""),
      userId: String(err?.ctx?.from?.id || "")
    });

    try {
      await err.ctx?.reply("Something went wrong. Please try again.");
    } catch {}
  });

  await bot.init().catch(() => {});

  await registerCommands(bot, cfg);

  bot.on("message", async (ctx, next) => {
    const ok = await shouldHandleGroupMessage(ctx);
    if (!ok) return next();
    return next();
  });

  bot.on("message:document", async (ctx) => {
    await saveUserTurn(ctx, "[document] " + (ctx.message?.document?.file_name || "file"));
    await handleDocument(ctx, cfg);
  });

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (!msg) return;

    if (msg.photo || msg.sticker || msg.voice || msg.video || msg.audio) {
      const t = "Please send your file as a document upload (PDF, DOC, or DOCX).";
      await ctx.reply(t);
      await saveAssistantTurn(ctx, t);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const raw = isText(ctx) ? ctx.message.text : "";
    if (raw.startsWith("/")) return next();

    await saveUserTurn(ctx, raw);

    ctx.session.store ??= {};
    ctx.session.store.mergeQueue ??= [];

    const t = raw.trim().toLowerCase();

    if (ctx.session.store.currentMode === "merge_pdfs") {
      if (t === "done" || t === "merge" || t === "merge now") {
        await doMergeNow(ctx, cfg, true);
        return;
      }

      if (t === "remove last") {
        const removed = ctx.session.store.mergeQueue.pop();
        const n = ctx.session.store.mergeQueue.length;
        const msg = removed
          ? "Removed the last PDF. Now queued: " + n + "."
          : "Nothing to remove.";
        await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
        await saveAssistantTurn(ctx, msg);
        ctx.session.store.lastAction = "merge_remove_last";
        return;
      }

      if (t === "clear") {
        ctx.session.store.mergeQueue = [];
        ctx.session.store.mergeConfirmed = false;
        const msg = "Cleared the merge queue. Send PDFs again in the order you want.";
        await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
        await saveAssistantTurn(ctx, msg);
        ctx.session.store.lastAction = "merge_cleared";
        return;
      }

      if (t === "yes") {
        await doMergeNow(ctx, cfg, false);
        return;
      }
    }

    let interpreted;
    try {
      console.log("[ai] intent start", {
        chatId: String(ctx.chat?.id || ""),
        userId: String(ctx.from?.id || "")
      });
      interpreted = await aiInterpretText(ctx, raw);
      console.log("[ai] intent success", { intent: interpreted.intent });
    } catch (e) {
      console.error("[ai] intent failure", { err: safeErr(e) });
      interpreted = { intent: "unknown", reply: "" };
    }

    const intent = interpreted.intent;

    if (intent === "set_mode_pdf_to_word") {
      ctx.session.store.currentMode = "pdf_to_word";
      const msg = interpreted.reply || "OK. Send a PDF as a document and I’ll convert it to Word.";
      await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
      await saveAssistantTurn(ctx, msg);
      ctx.session.store.lastAction = "mode_pdf_to_word";
      return;
    }

    if (intent === "set_mode_word_to_pdf") {
      ctx.session.store.currentMode = "word_to_pdf";
      const msg = interpreted.reply || "OK. Send a .doc or .docx as a document and I’ll convert it to PDF.";
      await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
      await saveAssistantTurn(ctx, msg);
      ctx.session.store.lastAction = "mode_word_to_pdf";
      return;
    }

    if (intent === "set_mode_merge_pdfs") {
      ctx.session.store.currentMode = "merge_pdfs";
      ctx.session.store.mergeConfirmed = false;
      const msg = interpreted.reply || "OK. Send PDFs one by one. When you’re ready, press Merge now or send done.";
      await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
      await saveAssistantTurn(ctx, msg);
      ctx.session.store.lastAction = "mode_merge_pdfs";
      return;
    }

    if (intent === "merge_done") {
      ctx.session.store.currentMode = "merge_pdfs";
      await doMergeNow(ctx, cfg, true);
      return;
    }

    if (intent === "merge_remove_last") {
      ctx.session.store.currentMode = "merge_pdfs";
      const removed = ctx.session.store.mergeQueue.pop();
      const n = ctx.session.store.mergeQueue.length;
      const msg = removed
        ? "Removed the last PDF. Now queued: " + n + "."
        : "Nothing to remove.";
      await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
      await saveAssistantTurn(ctx, msg);
      ctx.session.store.lastAction = "merge_remove_last";
      return;
    }

    if (intent === "merge_clear") {
      ctx.session.store.currentMode = "merge_pdfs";
      ctx.session.store.mergeQueue = [];
      ctx.session.store.mergeConfirmed = false;
      const msg = "Cleared the merge queue. Send PDFs again in the order you want.";
      await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
      await saveAssistantTurn(ctx, msg);
      ctx.session.store.lastAction = "merge_cleared";
      return;
    }

    if (intent === "status") {
      const mode = ctx.session.store.currentMode;
      const n = ctx.session.store.mergeQueue.length;
      const last = ctx.session.store.lastAction || "";
      const msg =
        "Mode: " +
        String(mode || "none") +
        "\nQueued PDFs: " +
        String(n) +
        (last ? "\nLast: " + last : "");
      await ctx.reply(msg);
      await saveAssistantTurn(ctx, msg);
      return;
    }

    if (intent === "reset") {
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

      const msg = "Reset done. Send a PDF, DOCX, or tell me what you want (pdf to word, word to pdf, merge pdfs).";
      await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
      await saveAssistantTurn(ctx, msg);
      return;
    }

    if (intent === "help") {
      const msg =
        "I can: PDF to Word, Word to PDF, and merge PDFs.\n\nTry saying: pdf to word, word to pdf, or merge pdfs.";
      await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
      await saveAssistantTurn(ctx, msg);
      return;
    }

    const fallback =
      interpreted.reply ||
      "Tell me what you want: pdf to word, word to pdf, or merge pdfs. You can also just send a PDF or DOCX.";
    await ctx.reply(fallback, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, fallback);
  });

  bot.callbackQuery("mode:pdf_to_word", async (ctx) => {
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "pdf_to_word";
    ctx.session.store.lastAction = "mode_pdf_to_word";
    await ctx.answerCallbackQuery();
    const msg = "Send a PDF as a document and I’ll convert it to Word.";
    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, msg);
  });

  bot.callbackQuery("mode:word_to_pdf", async (ctx) => {
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "word_to_pdf";
    ctx.session.store.lastAction = "mode_word_to_pdf";
    await ctx.answerCallbackQuery();
    const msg = "Send a .doc or .docx as a document and I’ll convert it to PDF.";
    await ctx.reply(msg, { reply_markup: buildMainKeyboard() });
    await saveAssistantTurn(ctx, msg);
  });

  bot.callbackQuery("mode:merge_pdfs", async (ctx) => {
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "merge_pdfs";
    ctx.session.store.mergeConfirmed = false;
    ctx.session.store.mergeQueue ??= [];
    ctx.session.store.lastAction = "mode_merge_pdfs";
    await ctx.answerCallbackQuery();
    const msg = "Send PDFs one by one. When ready, press Merge now or send done.";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
  });

  bot.callbackQuery("merge:now", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "merge_pdfs";
    await doMergeNow(ctx, cfg, true);
  });

  bot.callbackQuery("merge:remove_last", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "merge_pdfs";
    ctx.session.store.mergeQueue ??= [];
    const removed = ctx.session.store.mergeQueue.pop();
    const n = ctx.session.store.mergeQueue.length;
    const msg = removed
      ? "Removed the last PDF. Now queued: " + n + "."
      : "Nothing to remove.";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
    ctx.session.store.lastAction = "merge_remove_last";
  });

  bot.callbackQuery("merge:clear", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.store ??= {};
    ctx.session.store.currentMode = "merge_pdfs";
    ctx.session.store.mergeQueue = [];
    ctx.session.store.mergeConfirmed = false;
    const msg = "Cleared the merge queue. Send PDFs again in the order you want.";
    await ctx.reply(msg, { reply_markup: buildMergeKeyboard() });
    await saveAssistantTurn(ctx, msg);
    ctx.session.store.lastAction = "merge_cleared";
  });

  return bot;
}
