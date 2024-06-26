import { getLastLogs } from "./getLastLogs.js";
import { outputDatedLine } from "./outputDatedLine.js";
import sleep from "../utils/sleep.js";

const debug = false;

export async function waitForLogFileUpdate(cursor = 0, pids = [], modes = []) {
  for (let cycle = 0; true; cycle++) {
    await sleep(200);
    const next = await getLastLogs(modes);
    if (cycle === 0) {
      console.log(`Waiting for log updates (currently ${next.names.length} files matched modes)`);
      debug && console.log("Mode filters:", modes);
      debug && console.log("Previous pids:", pids);
      debug && console.log("Cursor:", cursor);
    }
    const list = next.list.filter((l) => l.time > cursor);
    if (list.length === 0) {
      await sleep(200);
      continue;
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const prefix = obj.file[0].toUpperCase();
      outputDatedLine(`[${prefix}]`, obj.time, obj.pid, obj.src, obj.text);
    }
    if (!pids || pids.length === 0 || cycle > 15) {
      return list;
    }
    const novelPids = [...new Set(list.map((a) => a.pid).filter((p) => !pids.includes(p)))];
    if (novelPids.length) {
      debug && console.log("New pid at logs:", novelPids);
      return list;
    }
    continue;
  }
}
