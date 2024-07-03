import { getLastLogs } from "./getLastLogs.js";
import { outputDatedLine } from "./outputDatedLine.js";
import sleep from "../utils/sleep.js";

const debugWaitForLog = false;

export async function waitForLogFileUpdate(cursor = 0, pids = [], modes = []) {
  for (let cycle = 0; true; cycle++) {
    await sleep(200);
    const next = await getLastLogs(modes);
    if (cycle === 0) {
      console.log(`Waiting for log updates (currently ${next.names.length} files matched modes)`);
      debugWaitForLog && console.log("Mode filters:", modes);
      debugWaitForLog && console.log("Previous pids:", pids);
      debugWaitForLog && console.log("Cursor:", cursor);
    }
    const list = next.list.filter((l) => l.time > cursor);
    if (list.length === 0) {
      await sleep(200);
      continue;
    }
    if (!pids || pids.length === 0 || cycle > 15) {
      console.log("Log file updated:\n");
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const prefix = obj.file;
      outputDatedLine(`[${prefix}]`, obj.time, obj.pid, obj.src, obj.text);
    }
    if (!pids || pids.length === 0 || cycle > 15) {
      return list;
    }
    const novelPids = [...new Set(list.map((a) => a.pid).filter((p) => !pids.includes(p)))];
    if (novelPids.length) {
      debugWaitForLog && console.log("New pid at logs:", novelPids);
      return list;
    }
    continue;
  }
}
