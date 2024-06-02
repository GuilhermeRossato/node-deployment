import fs from "fs";
import { asyncTryCatchNull } from "./asyncTryCatchNull.mjs";


export async function safeFileRead(file) {
  try {
    const text = await asyncTryCatchNull(fs.promises.readFile(file, "utf-8"));
    if (typeof text === "string") {
      return text;
    }
  } catch (err) {
    // Ignore
  }
  return null;
}
