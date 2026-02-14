import { MongoClient } from "mongodb";
import { safeErr } from "./safeErr.js";

let _client = null;
let _db = null;
let _indexEnsured = false;

export async function getDb(mongoUri) {
  if (!mongoUri) return null;
  if (_db) return _db;

  try {
    _client = new MongoClient(mongoUri, { maxPoolSize: 5, ignoreUndefined: true });
    await _client.connect();
    _db = _client.db();

    console.log("[db] connected", { mongoSet: true });

    if (!_indexEnsured) {
      await ensureIndexes(_db);
      _indexEnsured = true;
    }

    return _db;
  } catch (e) {
    console.error("[db] connect failed", { err: safeErr(e) });
    _db = null;
    return null;
  }
}

async function ensureIndexes(db) {
  try {
    const col = db.collection("memory_messages");
    await col.createIndex({ platform: 1, userId: 1, chatId: 1, ts: -1 });
  } catch (e) {
    console.error("[db] ensureIndexes failed", { err: safeErr(e) });
  }
}
