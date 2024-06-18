import { getLastLogs } from "./getLastLogs.js";
import { outputDatedLine } from "./outputDatedLine.js";

export async function printPreviousLogs(count = 15, modes = ['process']) {
  const logs = await getLastLogs(modes);
  const list = logs.list.slice(Math.max(0, logs.list.length - count));
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    outputDatedLine(`[${obj.mode[0].toUpperCase()}]`, obj.time, obj.pid, obj.src, obj.text);
  }
  return list;
}
