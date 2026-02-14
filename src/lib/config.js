export const cfg = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  MONGODB_URI: process.env.MONGODB_URI || "",

  COOKMYBOTS_AI_ENDPOINT:
    process.env.COOKMYBOTS_AI_ENDPOINT || "https://api.cookmybots.com/api/ai",
  COOKMYBOTS_AI_KEY: process.env.COOKMYBOTS_AI_KEY || "",

  AI_TIMEOUT_MS: Number(process.env.AI_TIMEOUT_MS || 600000),
  AI_MAX_RETRIES: Number(process.env.AI_MAX_RETRIES || 2),
  CONCURRENCY: Number(process.env.CONCURRENCY || 20),

  MAX_FILE_MB: Number(process.env.MAX_FILE_MB || 20),
  ADMIN_TELEGRAM_USER_ID: process.env.ADMIN_TELEGRAM_USER_ID || ""
};
