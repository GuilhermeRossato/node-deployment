import fs from "fs";
import { getPersistFilePath } from "./attachToProcessLog.mjs";
import { sleep } from "./sleep.mjs";
import { safeFileStat } from "./safeFileStat.mjs";

export async function getLatestLogs(deploymentLog = undefined) {
  const logPattern = ["\n", "2", "0"].map((c) => c.charCodeAt(0));
  const dateLength = new Date().toISOString().length;
  if (!deploymentLog) {
    deploymentLog = getPersistFilePath();
  }
  // Try to find stable moment to read
  let stat;
  for (let i = 0; i < 4; i++) {
    await sleep(10 + Math.random() * 10);
    stat = await safeFileStat(deploymentLog);
    if (!stat || !stat.mtimeMs || isNaN(stat.mtimeMs)) {
      continue;
    }
    if (new Date().getTime() - stat.mtimeMs > 20) {
      break;
    }
  }
  if (!stat || !stat.size) {
    return [];
  }
  // Read file at tail
  const buffer = Buffer.alloc(1024);
  const file = await fs.promises.open(deploymentLog, "r");
  stat = await file.stat();
  const { bytesRead } = await file.read({
    position: Math.max(0, stat.size - buffer.byteLength),
    buffer,
    length: buffer.byteLength,
  });
  const splits = [];
  for (let i = 0; i < bytesRead - 4; i++) {
    if (buffer[i] === logPattern[0] &&
      buffer[i + 1] === logPattern[1] &&
      buffer[i + 2] === logPattern[2]) {
      const prev = splits[splits.length - 1];
      const end = prev ? prev[1] : -1;
      splits.push([end + 1, i + 1]);
      i++;
    }
  }
  const lines = splits
    .map(([start, end]) => buffer.toString("utf8", start, end).split(" - "))
    .filter(
      (parts) => parts.length >= 4 &&
        parts[0].trim().length === dateLength &&
        parts[0].startsWith("2") &&
        parts[2].trim().replace(/\d/g, "").length === 0
    );
  await file.close();
  return lines.map(([dateStr, srcStr, pidStr, ...rest]) => ({
    date: new Date(dateStr.trim()),
    src: srcStr.trim(),
    pid: parseInt(pidStr.trim()),
    message: rest.join(" - "),
  }));
}
