import { InputFile } from "grammy";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { safeErr } from "../lib/safeErr.js";
import { incConversionsCompleted } from "./stats.js";

function rand() {
  return crypto.randomBytes(8).toString("hex");
}

function extOf(name) {
  const n = String(name || "");
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1).toLowerCase() : "";
}

function stripExt(name) {
  const n = String(name || "file");
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(0, i) : n;
}

async function runSofficeConvert({ inputPath, outDir, targetExt, timeoutMs = 240000 }) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless",
      "--nologo",
      "--nolockcheck",
      "--nodefault",
      "--norestore",
      "--invisible",
      "--convert-to",
      targetExt,
      "--outdir",
      outDir,
      inputPath
    ];

    const child = spawn("soffice", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d || "");
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CONVERSION_TIMEOUT"));
    }, timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("LIBREOFFICE_FAILED: " + code + ": " + stderr));
        return;
      }
      resolve();
    });
  });
}

export async function convertDocument({ direction, inputBuffer, inputFilename }) {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "doc-tools-"));

  const inExt = extOf(inputFilename);
  const base = stripExt(inputFilename) || "file";

  const inputPath = path.join(tmpBase, "input." + (inExt || "bin"));
  await fs.writeFile(inputPath, inputBuffer);

  try {
    if (direction === "pdf_to_word") {
      const outExt = "docx";
      const outName = base + ".docx";

      console.log("[convert] libreoffice start", {
        direction,
        inputExt: inExt,
        outExt
      });

      await runSofficeConvert({
        inputPath,
        outDir: tmpBase,
        targetExt: outExt
      });

      const outPath = path.join(tmpBase, "input." + outExt);
      const outBuf = await fs.readFile(outPath);

      if (!outBuf?.length) throw new Error("EMPTY_OUTPUT");

      incConversionsCompleted();

      return {
        outputFilename: outName,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        outputBytes: outBuf.length,
        inputFile: new InputFile(outBuf, outName)
      };
    }

    if (direction === "word_to_pdf") {
      const outExt = "pdf";
      const outName = base + ".pdf";

      console.log("[convert] libreoffice start", {
        direction,
        inputExt: inExt,
        outExt
      });

      await runSofficeConvert({
        inputPath,
        outDir: tmpBase,
        targetExt: outExt
      });

      const outPath = path.join(tmpBase, "input." + outExt);
      const outBuf = await fs.readFile(outPath);

      if (!outBuf?.length) throw new Error("EMPTY_OUTPUT");

      incConversionsCompleted();

      return {
        outputFilename: outName,
        mimeType: "application/pdf",
        outputBytes: outBuf.length,
        inputFile: new InputFile(outBuf, outName)
      };
    }

    throw new Error("UNKNOWN_DIRECTION");
  } catch (e) {
    const msg = safeErr(e);

    if (
      msg.includes("spawn soffice") ||
      msg.includes("ENOENT") ||
      msg.toLowerCase().includes("soffice")
    ) {
      throw new Error(
        "CONVERTER_MISSING: LibreOffice (soffice) is not installed or not on PATH"
      );
    }

    throw e;
  } finally {
    try {
      await fs.rm(tmpBase, { recursive: true, force: true });
    } catch {}
  }
}
