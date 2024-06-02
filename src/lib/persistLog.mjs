import fs from "fs";
import path from "path";
import { sleep } from "./sleep.mjs";

export async function persistLog(filePath, ...args) {
  const text = args
    .map((a) => typeof a === "object" && a instanceof Error
      ? a.stack
      : typeof a === "string"
        ? a
        : JSON.stringify(a)
    )
    .join(" ");
  if (persistLog["init"] !== filePath) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    persistLog["init"] = filePath;
  }
  if (!persistLog["wait"]) {
    await sleep(25 + Math.random() * 50);
  }
  persistLog["wait"] = true;
  let r;
  try {
    r = await fs.promises.appendFile(filePath, `${text}\n`, "utf-8");
  } catch (err) {
    r = err;
  }
  persistLog["wait"] = false;
  if (r instanceof Error) {
    throw r;
  }
  return r;
}
