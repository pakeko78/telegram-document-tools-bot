import { getBootStats } from "../services/stats.js";

export default async function register(bot, cfg) {
  bot.command("admin_stats", async (ctx) => {
    const adminId = String(cfg.ADMIN_TELEGRAM_USER_ID || "").trim();
    if (!adminId || String(ctx.from?.id || "") !== adminId) return;

    const s = getBootStats();
    const msg =
      "Since boot:\n" +
      "Conversions completed: " +
      String(s.conversionsCompleted) +
      "\nMerges completed: " +
      String(s.mergesCompleted);

    await ctx.reply(msg);
  });
}
