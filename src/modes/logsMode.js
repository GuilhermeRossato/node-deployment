import sleep from "../utils/sleep.js";
import { outputDatedLine, outputLogEntry } from "../logs/outputDatedLine.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initLogs(options) {
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  const prefixes = options.mode === "runtime" ? ["instance"] : [];
  const logs = await getLastLogs(prefixes);
  if (logs.names.length === 0) {
    console.log("Could not find any log file");
  } else {
    process.stdout.write(`Loaded ${logs.names.length} log files from ${JSON.stringify(logs.projectPath)}`);
    process.stdout.write("\n");
    const header = "     log-file          yyyy-mm-dd hh:mm:ss        source - pid - text...      ";
    process.stdout.write(`${"-".repeat(header.length)}\n`);
    process.stdout.write(`${header}\n`);
    process.stdout.write(`${"-".repeat(header.length)}\n`);
    await sleep(200);
  }
  const list = logs.list;
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  let cursor = 0;
  let i = Math.max(0, list.length - 50);
  for (i = i; i < list.length; i++) {
    const obj = list[i];
    cursor = outputLogEntry(obj.file.substring(obj.file.length - 20).padStart(20), obj);
  }
  if (options.debug) {
    console.log("");
    if (prefixes.length) {
      console.log("Filters  :", JSON.stringify(prefixes));
    }
    console.log("Current  :", getDateTimeString(new Date().getTime(), true));
    if (list.length) {
      const runs = await isProcessRunningByPid(list[list.length - 1].pid);
      console.log(
        "Last file:",
        JSON.stringify(list[list.length - 1].file),
        "(written by pid",
        list[list.length - 1].pid,
        "which",
        runs ? "is still running)" : "is no longer running)"
      );
    }
    console.log(
      "Last log :",
      getDateTimeString(cursor),
      `(updated ${getIntervalString(new Date().getTime() - cursor)} ago)`
    );
    console.log("");

    await sleep(1000);
  }
  process.stdout.write("\n");
  await sleep(200);
  console.log(" Watching Logs:");
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  await streamStatusLogs(cursor, true, prefixes);
}

export async function streamStatusLogs(cursor = 0, continuous = true, prefixes = []) {
  let lastPrint = new Date().getTime();
  for (let cycle = 0; true; cycle++) {
    await sleep(300);
    const all = await getLastLogs(prefixes);
    const list = all.list.filter((l) => l.time > cursor);
    if (list.length === 0) {
      await sleep(300);
      if (lastPrint && new Date().getTime() - lastPrint > 60_000) {
        process.stdout.write(`  (No updates since ${getDateTimeString(cursor)})\n`);
        lastPrint = 0;
      }
    } else {
      lastPrint = new Date().getTime();
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (obj.file.endsWith("logs.log")) {
        continue;
      }
      cursor = outputLogEntry(obj.file.substring(obj.file.length - 16).padStart(16), obj);
      await sleep(15);
    }
    if (!continuous) {
      break;
    }
  }
}
