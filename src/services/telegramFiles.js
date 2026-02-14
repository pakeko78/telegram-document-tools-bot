import https from "node:https";
import { safeErr } from "../lib/safeErr.js";

function getFileUrl(token, filePath) {
  return "https://api.telegram.org/file/bot" + token + "/" + filePath;
}

function download(url, { maxBytes }) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error("Download failed with status " + res.statusCode));
        res.resume();
        return;
      }

      const chunks = [];
      let bytes = 0;

      res.on("data", (d) => {
        bytes += d.length;
        if (maxBytes && bytes > maxBytes) {
          req.destroy(new Error("FILE_TOO_LARGE"));
          return;
        }
        chunks.push(d);
      });

      res.on("end", () => {
        resolve({ buffer: Buffer.concat(chunks), bytes });
      });

      res.on("error", (e) => reject(e));
    });

    req.on("error", (e) => reject(e));
  });
}

export async function downloadTelegramDocument(api, token, document, { maxBytes }) {
  const fileId = document.file_id;

  console.log("[tgfile] getFile start", {
    fileId: String(fileId).slice(0, 12) + "...",
    sizeBytes: Number(document.file_size || 0)
  });

  let file;
  try {
    file = await api.getFile(fileId);
  } catch (e) {
    console.error("[tgfile] getFile failed", { err: safeErr(e) });
    throw e;
  }

  const filePath = file?.file_path;
  if (!filePath) throw new Error("TELEGRAM_FILE_PATH_MISSING");

  const url = getFileUrl(token, filePath);

  console.log("[tgfile] download start", {
    filePath: String(filePath).slice(0, 60),
    maxBytes: Number(maxBytes || 0)
  });

  try {
    const res = await download(url, { maxBytes });
    console.log("[tgfile] download success", { bytes: res.bytes });
    return {
      buffer: res.buffer,
      bytes: res.bytes,
      filePath
    };
  } catch (e) {
    console.error("[tgfile] download failed", { err: safeErr(e) });
    if (String(safeErr(e)).includes("FILE_TOO_LARGE")) {
      throw new Error("FILE_TOO_LARGE");
    }
    throw e;
  }
}
