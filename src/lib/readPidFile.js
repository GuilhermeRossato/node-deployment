import fs from "fs";
import asyncTryCatchNull from "./asyncTryCatchNull.js";
import { isProcessRunningByPid } from "../manager/isProcessRunningByPid.js";

export async function readPidFile(mode) {
  const stat = await asyncTryCatchNull(fs.promises.stat(`${mode}.pid`));
  if (!(stat instanceof fs.Stats)) {
    return {
      time: NaN,
      pid: null,
      running: false,
    };
  }
  const pid = await asyncTryCatchNull(
    fs.promises.readFile(`${mode}.pid`, "utf-8")
  );
  const valid = typeof pid === "string" && /\D/g.test(pid.trim());
  return {
    time: stat.mtimeMs,
    pid: valid ? parseInt(pid.trim()) : null,
    running: valid && (await isProcessRunningByPid(pid)),
  };
}
