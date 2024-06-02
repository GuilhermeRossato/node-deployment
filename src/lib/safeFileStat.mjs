import fs from "fs";
import { asyncTryCatchNull } from "./asyncTryCatchNull.mjs";


export async function safeFileStat(file) {
  try {
    const stat = await asyncTryCatchNull(fs.promises.stat(file));
    if (stat instanceof fs.Stats) {
      return stat;
    }
  } catch (err) {
    // Ignore
  }
  return null;
}
