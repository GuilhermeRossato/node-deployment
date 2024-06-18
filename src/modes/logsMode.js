
import sleep from "../lib/sleep.js";
import { outputDatedLine } from "../lib/outputDatedLine.js";
import { printPreviousLogs } from "../lib/printPreviousLogs.js";
import { getLastLogs } from "../lib/getLastLogs.js";

export async function initLogs() {
  const list = await printPreviousLogs(-30, []);
  const cursor = list.length === 0 ? 0 : Math.min(...list.map(a => a.mode === 'logs' ? 0 : a.time).filter(a => a > 0));
  console.log('Logs:');
  await sleep(500);
  await streamStatusLogs(cursor, true, ["setup", "schedule", "process", "manager"]);
}

export async function streamStatusLogs(cursor = 0, continuous = true, modes = ["schedule", "process", "manager", "setup"]) {
  for (let cycle = 0; true; cycle++) {
    await sleep(200);
    const all = await getLastLogs(modes);
    const list = all.list.filter(l => l.time > cursor);
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (obj.mode === 'status') {
        continue;
      }
      outputDatedLine(`[${obj.mode[0].toUpperCase()}]`, obj.time, obj.pid, obj.src, obj.text);
      await sleep(10);
      cursor = obj.time;
    }
    if (!continuous) {
      break;
    }
  }
}
