// @ts-check
import path from "path";
import { getLastLogs, streamLogs } from "../lib/streamLogs.js";
import { spawnBackgroundChild } from "../lib/spawnBackgroundChild.js";
import { outputDatedLine } from "../lib/outputDatedLine.js";
import sleep from "../lib/sleep.js";

const hasSyncArg = process.argv.includes("--sync");

/**
 * @param {import("../getProgramArgs.js").Options} options
 */
export async function initScheduler(options) {
  const debug = true;
  
  const exe = process.argv[0];
  const script = process.argv[1];
  const childArgs = [script, "--process", ...process.argv.slice(3)];
  const childCwd = process.cwd();
  const scriptName = path.basename(childArgs[0]);

  console.log(
    `Starting "${scriptName}" with ${childArgs.length - 1} arguments`
  );

  console.log(`Executing: "${exe}"`);
  console.log("Child arg:", childArgs);
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
    spawnBackgroundChild(exe, childArgs, childCwd, !hasSyncArg),
  ]);
}
async function printPreviousLogs(count = 15, modes = ['process']) {
  const logs = await getLastLogs(modes);
  const list = logs.list.slice(Math.max(0, logs.list.length-count));
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    outputDatedLine('[P]', obj.time, obj.pid, obj.src, obj.text);
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
      outputDatedLine('[P]', obj.time, obj.pid, obj.src, obj.text);
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



