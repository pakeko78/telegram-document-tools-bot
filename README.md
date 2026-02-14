This is a Telegram bot (grammY) that provides document utilities:

1) PDF to Word (.docx)
2) Word (.doc/.docx) to PDF
3) Merge multiple PDFs into one PDF

It’s designed to run as a single Node.js service on Render using long polling.

Setup

1) Install

npm install

2) Configure environment variables

Copy .env.sample to .env and fill in:

1) TELEGRAM_BOT_TOKEN (required)
2) COOKMYBOTS_AI_ENDPOINT (required for AI intent parsing and friendly replies)
3) COOKMYBOTS_AI_KEY (required)
4) MONGODB_URI (optional but recommended for long-term memory)
5) MAX_FILE_MB (optional, defaults to 20)
6) ADMIN_TELEGRAM_USER_ID (optional)

3) Run locally

npm run dev

4) Run in production

npm start

Commands

1) /start
Shows what the bot can do and how to use it.

2) /help
Shows commands and examples.

3) /status
Shows current mode, merge queue size, and last action.

4) /reset
Clears the current workflow state and clears your stored memory.

Document processing backend

PDF merge is implemented in-process using pdf-lib.

PDF to Word and Word to PDF conversions require LibreOffice to be available on the system.
The bot will try to run the libreoffice binary (soffice). If it’s missing, the bot will fail gracefully and explain what’s needed.

On Render, you may need to use a Docker-based deployment or a build step that provides LibreOffice.
If LibreOffice is not present, PDF merge still works.

Database and memory

If MONGODB_URI is set, the bot stores conversation turns in a MongoDB collection:

memory_messages
Fields: userId (string), platform (telegram), chatId (string), role (user|assistant), text, ts

If MONGODB_URI is not set, the bot uses an in-memory fallback and prints a warning log.

Troubleshooting

1) Bot does not respond
Make sure TELEGRAM_BOT_TOKEN is set and valid.

2) Conversion fails immediately
LibreOffice is likely not installed or not on PATH. Deploy with LibreOffice available.

3) File too large
Increase MAX_FILE_MB or send a smaller file.

Extending

Add new commands in src/commands/*.js and they will be auto-registered by src/commands/loader.js.
Shared helpers live under src/lib and src/services.
