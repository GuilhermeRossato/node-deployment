import { getLastLogs } from "./getLastLogs.js";
import { outputDatedLine } from "./outputDatedLine.js";
import sleep from "./sleep.js";

export async function waitForLogFileUpdate(cursor = 0, pids = [], modes = []) {
  for (let cycle = 0; true; cycle++) {
    await sleep(100);
    const next = await getLastLogs(modes);
    const list = next.list.filter(l => l.time > cursor);
    if (list.length === 0) {
      await sleep(250);
      continue;
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      outputDatedLine(`[${obj.mode[0].toUpperCase()}]`, obj.time, obj.pid, obj.src, obj.text);
    }
    const newPid = list.map(a => a.pid).find(a => !pids.includes(a));
    if (newPid) {
      console.debug('New pid at logs:', newPid);
      break;
    }
    await sleep(250);
    continue;
  }
}
