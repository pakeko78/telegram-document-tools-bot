import { cfg } from "./config.js";
import { safeErr } from "./safeErr.js";

function clampBaseUrl(u) {
  const s = String(u || "").trim();
  return s.replace(/\/+$/, "");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function aiChat({ messages, model, meta }) {
  const base = clampBaseUrl(cfg.COOKMYBOTS_AI_ENDPOINT);
  const url = base + "/chat";

  const timeoutMs = Number(cfg.AI_TIMEOUT_MS || 600000);
  const maxRetries = Number(cfg.AI_MAX_RETRIES || 2);

  if (!cfg.COOKMYBOTS_AI_KEY) {
    throw new Error("COOKMYBOTS_AI_KEY missing");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      console.log("[ai] call start", {
        endpoint: "/chat",
        attempt: attempt + 1,
        meta: meta || {}
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.COOKMYBOTS_AI_KEY
        },
        body: JSON.stringify({
          messages,
          model,
          meta
        }),
        signal: ctrl.signal
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json?.error || json?.message || "AI request failed with status " + res.status;
        throw new Error(msg);
      }

      const content = json?.output?.content;
      if (typeof content !== "string") {
        throw new Error("AI response missing output.content");
      }

      console.log("[ai] call success", {
        endpoint: "/chat",
        meta: meta || {}
      });

      return content;
    } catch (e) {
      const msg = safeErr(e);
      console.error("[ai] call failure", {
        endpoint: "/chat",
        attempt: attempt + 1,
        err: msg
      });
      if (attempt >= maxRetries) throw e;
      await sleep(400 * Math.pow(2, attempt));
    } finally {
      clearTimeout(t);
    }
  }

  throw new Error("AI request failed");
}
