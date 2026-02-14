import { PDFDocument } from "pdf-lib";
import { InputFile } from "grammy";
import { safeErr } from "../lib/safeErr.js";
import { incMergesCompleted } from "./stats.js";

export async function mergePdfs(buffers) {
  try {
    const out = await PDFDocument.create();

    for (const b of buffers) {
      const doc = await PDFDocument.load(b, { ignoreEncryption: false });
      const pages = await out.copyPages(doc, doc.getPageIndices());
      for (const p of pages) out.addPage(p);
    }

    const bytes = await out.save();
    const buf = Buffer.from(bytes);

    if (!buf.length) throw new Error("EMPTY_OUTPUT");

    incMergesCompleted();

    return {
      outputBytes: buf.length,
      inputFile: new InputFile(buf, "merged.pdf")
    };
  } catch (e) {
    const msg = safeErr(e);
    if (msg.toLowerCase().includes("encrypted")) {
      throw new Error("ENCRYPTED_PDF");
    }
    throw e;
  }
}
