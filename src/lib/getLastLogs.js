import fs from "node:fs";
import path from "node:path";
import readLogFile from "./readLogFile.js";
import asyncTryCatchNull from "./asyncTryCatchNull.js";

/**
 * 
 * @param {string[]} modes 
 * @param {number} size 
 * @param {Buffer[]} buffers 
 */
export async function getLastLogs(
  modes = ["status", "setup", "schedule", "process", "manager"],
  size = 4096,
  buffers = []
) {
  if (modes.length === 0) {
    const logFolder = path.resolve(
      process.env.LOG_FOLDER_PATH || process.cwd()
    );
    const files = await asyncTryCatchNull(fs.promises.readdir(logFolder));
    if (files instanceof Array) {
      for (const file of files) {
        if (file.endsWith(".log")) {
          modes.push(file.substring(0, file.lastIndexOf(".")));
        }
      }
    }
  }
  const logList = await Promise.all(
    modes.map((mode, i) =>
      readLogFile(
        path.resolve(
          process.env.LOG_FOLDER_PATH || process.cwd(),
          `${mode}.log`
        ),
        -size,
        buffers[i]
      )
    )
  );
  for (let i = buffers.length; i < logList.length; i++) {
    buffers.push(logList[i].buffer);
  }
  const list = logList
    .map((log, j) =>
      log.list
        .map((o, i, a) => ({
          time: a
            .slice(0, i + 1)
            .reverse()
            .map((a) => a.time)
            .find((a) => a && !isNaN(a)),
          src: o.src,
          pid: o.pid,
          mode: modes[j],
          text: o.text,
        }))
        .filter((o) => o.time && !isNaN(o.time))
    )
    .flat()
    .sort((a, b) => a.time - b.time);
  return {
    list,
    modes,
    buffers,
  };
}
