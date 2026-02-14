What this bot does

This Telegram bot converts documents and merges PDFs.

Supported actions

1) PDF to Word (.docx)
2) Word (.doc/.docx) to PDF
3) Merge multiple PDFs into one PDF

Public commands

1) /start
What it does: Welcome message and quick instructions.
Usage: /start

2) /help
What it does: Shows help and examples.
Usage: /help

3) /status
What it does: Shows your current mode (if any), merge queue count, and last action.
Usage: /status

4) /reset
What it does: Clears your workflow state and clears your stored memory.
Usage: /reset

How to use in chat

1) Send “pdf to word” then upload a PDF.
2) Send “word to pdf” then upload a DOC/DOCX.
3) Send “merge pdfs” then upload PDFs in order. When ready, send “done” or press “Merge now”.

While merging, you can also send “remove last” or “clear”.

Environment variables

1) TELEGRAM_BOT_TOKEN (required)
Telegram bot token.

2) COOKMYBOTS_AI_ENDPOINT (required)
Base URL for the CookMyBots AI gateway. Must be a base URL ending with /api/ai.

3) COOKMYBOTS_AI_KEY (required)
API key for the CookMyBots AI gateway.

4) MONGODB_URI (optional)
MongoDB connection string for long-term memory.

5) MAX_FILE_MB (optional)
Maximum allowed file size in MB. Default is 20.

6) ADMIN_TELEGRAM_USER_ID (optional)
If set, enables /admin_stats for that Telegram user id.

Run

1) Install: npm install
2) Start: npm start
3) Dev: npm run dev
