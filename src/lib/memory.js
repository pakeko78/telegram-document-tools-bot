import { getDb } from "./db.js";

const COL = "memory_messages";

const inMem = new Map();
let warned = false;

function keyOf({ platform, userId, chatId }) {
  return String(platform) + ":" + String(userId) + ":" + String(chatId || "");
}

function clampText(t, max = 4000) {
  const s = String(t || "");
  return s.length > max ? s.slice(0, max) : s;
}

export async function addTurn({ mongoUri, platform, userId, chatId, role, text }) {
  const doc = {
    platform: String(platform),
    userId: String(userId || ""),
    chatId: String(chatId || ""),
    role: String(role),
    text: clampText(text),
    ts: new Date()
  };

  const db = await getDb(mongoUri);
  if (db) {
    try {
      await db.collection(COL).insertOne(doc);
      return;
    } catch (e) {
      console.error("[memory] insert failed", { err: e?.message || String(e) });
    }
  }

  if (!warned) {
    warned = true;
    console.warn("[memory] MONGODB_URI not set or DB unavailable; using in-memory fallback");
  }

  const k = keyOf(doc);
  const arr = inMem.get(k) || [];
  arr.push({ role: doc.role, text: doc.text, ts: doc.ts });
  while (arr.length > 50) arr.shift();
  inMem.set(k, arr);
}

export async function getRecentTurns({ mongoUri, platform, userId, chatId, limit = 14 }) {
  const db = await getDb(mongoUri);
  if (db) {
    const q = {
      platform: String(platform),
      userId: String(userId || ""),
      chatId: String(chatId || "")
    };

    const rows = await db
      .collection(COL)
      .find(q)
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    return rows
      .reverse()
      .map((r) => ({ role: String(r.role), text: String(r.text || "") }));
  }

  if (!warned) {
    warned = true;
    console.warn("[memory] MONGODB_URI not set or DB unavailable; using in-memory fallback");
  }

  const k = keyOf({ platform, userId, chatId });
  const arr = inMem.get(k) || [];
  return arr.slice(-limit).map((r) => ({ role: r.role, text: r.text }));
}

export async function clearUserMemory({ mongoUri, platform, userId, chatId }) {
  const db = await getDb(mongoUri);
  if (db) {
    const q = {
      platform: String(platform),
      userId: String(userId || ""),
      chatId: String(chatId || "")
    };

    await db.collection(COL).deleteMany(q);
    return;
  }

  const k = keyOf({ platform, userId, chatId });
  inMem.delete(k);
}
