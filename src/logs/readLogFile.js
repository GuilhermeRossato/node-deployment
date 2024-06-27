import fs from "node:fs";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";

export async function getLogFileStatus(root, mode) {
  let deploy = await checkPathStatus([
    root,
    process.env.DEPLOYMENT_FOLDER_NAME || process.env.LOG_FOLDER_NAME || "deployment",
  ]);
  if (!deploy.type.dir) {
    deploy = await checkPathStatus([
      root,
      ".git",
      process.env.DEPLOYMENT_FOLDER_NAME || process.env.LOG_FOLDER_NAME || "deployment",
    ]);
  }
  if (!deploy.type.dir) {
    throw new Error(`Deployment folder not found at ${JSON.stringify(deploy.path)}`);
  }
  if (mode.includes(".") || mode.includes("/")) {
    mode = mode.substring(mode.lastIndexOf("/") + 1, mode.lastIndexOf("."));
  }
  const name = `${mode}.log`;
  return await checkPathStatus([deploy.path, name]);
}

const extra = getDateTimeString(new Date(), true).substring(24);

function separateLogLineDate(line) {
  if (!line.trim().length || !line.startsWith("2")) {
    return null;
  }
  const dateTimeSep = line.indexOf(" ");
  const dateSrcSep = line.indexOf(" - ", dateTimeSep);
  const srcPidStep = line.indexOf(" - ", dateSrcSep + 3);
  if (dateTimeSep !== 10 || dateSrcSep === -1 || srcPidStep === -1) {
    return null;
  }
  const pidTxtStep = line.indexOf(" - ", srcPidStep + 3);
  const dateStr = line.substring(0, dateTimeSep);
  const timeStr = line.substring(dateTimeSep + 1, dateSrcSep);
  const srcStr = line.substring(dateSrcSep + 3, srcPidStep);
  const pidStr = line.substring(srcPidStep + 3, pidTxtStep);
  const time = new Date(`${dateStr} ${timeStr} ${extra}`).getTime();
  if (srcPidStep === -1 || !pidStr.length || /\D/g.test(pidStr)) {
    return { time, src: "", pid: 0, text: line.substring(dateSrcSep + 3).trim() };
  }
  if (pidTxtStep === -1) {
    return { time, src: "", pid: parseInt(pidStr), text: line.substring(srcPidStep + 3).trim() };
  }
  return { time, src: srcStr, pid: parseInt(pidStr), text: line.substring(pidTxtStep + 3).trim() };
}

/**
 * @param {string} filePath
 * @param {number} [offset]
 * @param {Buffer} [buffer]
 */
export default async function readLogFile(filePath, offset, buffer) {
  const result = {
    size: 0,
    read: 0,
    list: [].map(separateLogLineDate),
    buffer,
    offset,
    sizeDesc: "",
    readTime: new Date().getTime(),
    updateTime: 0,
    updateDesc: "",
    text: "",
  };
  const stat = await asyncTryCatchNull(fs.promises.stat(filePath));
  if (!stat || stat instanceof Error || stat.size === 0 || !stat.isFile()) {
    return result;
  }
  const size = (result.size = stat.size);
  result.updateTime = stat.mtimeMs;
  const elapsed = new Date().getTime() - stat.mtimeMs;
  const s = elapsed / 1000;
  const elapsedStr = isNaN(elapsed)
    ? "(never)"
    : s <= 1
    ? `${elapsed.toFixed(0)} ms`
    : s <= 60
    ? `${s.toFixed(1)} seconds`
    : s <= 60 * 60
    ? `${Math.floor(s / 60)} minutes and ${Math.floor(s % 1)} seconds`
    : s <= 24 * 60 * 60
    ? `${Math.floor(s / (60 * 60))}:${Math.floor(s / 60) % 1}:${Math.floor(s % 1)}`
    : `${Math.floor(s / (24 * 60 * 60))} days and ${Math.floor(s / (60 * 60)) % 1} hours`;

  result.sizeDesc = isNaN(elapsed)
    ? "(no file)"
    : size === 0
    ? "(empty)"
    : size < 1024
    ? `${size} bytes`
    : size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`;

  result.updateDesc = isNaN(elapsed) ? "(never)" : `${elapsedStr} ago (at ${stat.mtime.toISOString()})`;

  if (offset && offset >= stat.size) {
    result.offset = stat.size;
    return result;
  }
  const f = await asyncTryCatchNull(fs.promises.open(filePath, "r"));
  if (!f || f instanceof Error) {
    return result;
  }
  try {
    if (!result.buffer && !buffer) {
      buffer = Buffer.alloc(16384);
      result.buffer = buffer;
    }
    if (typeof offset === "number" && offset < 0) {
      offset = Math.max(0, result.size + offset);
    }
    if (
      buffer.byteLength &&
      (offset === undefined || offset === null || typeof offset !== "number" || offset < 0 || isNaN(offset))
    ) {
      offset = Math.max(0, stat.size - buffer.byteLength);
    }
    const readResult = await f.read({ position: offset, buffer });
    result.read = readResult.bytesRead;
  } catch (err) {
    await f.close();
    console.log("Failed reading logs:");
    console.log(err);
    return result;
  }
  await f.close();
  try {
    result.text = buffer.slice(0, result.read).toString("utf-8").trim().replace(/\r/g, "");
    const nl = result.text.indexOf("\n");
    if (nl !== -1 && nl < 20) {
      result.text = result.text.substring(result.text.indexOf("\n") + 1);
    }
    result.list = result.text.split("\n").map(separateLogLineDate).filter(Boolean);
  } catch (err) {
    console.debug(err);
  }
  result.offset = offset;
  return result;
}
