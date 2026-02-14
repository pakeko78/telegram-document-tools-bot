import { InlineKeyboard } from "grammy";

export function buildMainKeyboard() {
  const kb = new InlineKeyboard()
    .text("PDF to Word", "mode:pdf_to_word")
    .text("Word to PDF", "mode:word_to_pdf")
    .row()
    .text("Merge PDFs", "mode:merge_pdfs");

  return kb;
}

export function buildMergeKeyboard() {
  const kb = new InlineKeyboard()
    .text("Merge now", "merge:now")
    .row()
    .text("Remove last", "merge:remove_last")
    .text("Clear", "merge:clear");

  return kb;
}

export function isText(ctx) {
  return !!ctx.message?.text;
}
