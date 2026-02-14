import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function registerCommands(bot, cfg) {
  const dir = path.dirname(fileURLToPath(import.meta.url));

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && f !== "loader.js" && !f.startsWith("_"))
    .sort();

  for (const f of files) {
    const url = pathToFileURL(path.join(dir, f)).href;
    const mod = await import(url);

    const handler =
      (mod && (mod.default || mod.register)) ||
      (typeof mod === "function" ? mod : null);

    if (typeof handler === "function") {
      await handler(bot, cfg);
    } else {
      console.warn("[commands] skipped", { file: f });
    }
  }
}
