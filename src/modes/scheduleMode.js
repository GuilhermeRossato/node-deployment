// @ts-check
import path from "path";
import { getLastLogs } from "../lib/streamLogs.js";
import { spawnBackgroundChild } from "../lib/spawnBackgroundChild.js";
import { outputDatedLine } from "../lib/outputDatedLine.js";
import sleep from "../lib/sleep.js";

/**
 * @param {import("../getProgramArgs.js").Options} options
 */
export async function initScheduler(options) {
  const debug = true;
  
  const exe = process.argv[0];
  const script = process.argv[1];
  const args = [script, "--process"];
  if (options.ref) {
    args.push(options.ref);
  }
  if (options.debug) {
    args.push('--debug');
  }
  const childCwd = process.cwd();

  console.log(
    `Starting "${path.basename(script)}" with ${args.length - 1} arguments`
  );

  console.log(`Executing: "${exe}"`);
  console.log("Child arg:", args);
  console.log("Child cwd:", childCwd);

  debug &&
    console.log(
      "Starting processor at background and waiting for log update..."
    );
  const list = await printPreviousLogs(15, ['process']);
  debug &&
    console.log(
      `Processor has ${list.length} logs`
    );
  
  const cursor = list.length === 0 ? 0 : Math.min(...list.map(a => a.time).filter(a => a > 0));
  const pids = list.map(a => a.pid).filter(a => a > 0);
  await Promise.all([
    waitForLogFileUpdate(cursor, pids),
    spawnBackgroundChild(exe, args, childCwd, options.sync),
  ]);
}
async function printPreviousLogs(count = 15, modes = ['process']) {
  const logs = await getLastLogs(modes);
  const list = logs.list.slice(Math.max(0, logs.list.length-count));
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    outputDatedLine(`[${obj.mode[0].toUpperCase()}]`, obj.time, obj.pid, obj.src, obj.text);
  }
  return list;
}
async function waitForLogFileUpdate(cursor = 0, pids = [], modes = ['process']) {
  for (let cycle = 0; true; cycle++) {
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



