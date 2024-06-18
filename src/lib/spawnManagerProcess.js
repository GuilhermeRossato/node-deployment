import path from 'path';
import { spawnBackgroundChild } from './spawnBackgroundChild.js';
import { getLastLogs } from './streamLogs.js';
import { outputDatedLine } from './outputDatedLine.js';
import sendInternalRequest from './sendInternalRequest.js';
import sleep from './sleep.js';

export async function spawnManagerProcess(debug = false, detached = true) {
  debug && console.log('Starting manager at background and waiting for log update...');
  const exe = process.argv[0];
  const script = process.argv[1];
  const args = [script, "--manager"];
  if (debug) {
    args.push('--debug');
  }
  const childCwd = process.cwd();

  console.log(
    `Starting "${path.basename(script)}" with ${args.length - 1} arguments`
  );

  console.log(`Executing: "${exe}"`);
  console.log("Child arg:", args);
  console.log("Child cwd:", childCwd);

  const list = await printPreviousLogs(15, ['process']);
  debug &&
    console.log(
      `Manager has ${list.length} starting logs`
    );
  const cursor = list.length === 0 ? 0 : Math.min(...list.map(a => a.time).filter(a => a > 0));
  const pids = list.map(a => a.pid).filter(a => a > 0);
  await Promise.all([
    waitForLogFileUpdate(cursor, pids),
    spawnBackgroundChild(exe, args, childCwd, detached),
  ]);
  let success = false;
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    try {
      const response = await sendInternalRequest("manager", "status");
      const text = await response.text();
      if (response.ok && text.length) {
        success = true;
        break;
      }
    } catch (err) {
      // ignore
    }
  }
  if (!success) {
    throw new Error('Failed to execute manager at background');
  }
}

async function printPreviousLogs(count = 15, modes = ['manager']) {
  const logs = await getLastLogs(modes);
  const list = logs.list.slice(Math.max(0, logs.list.length-count));
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    outputDatedLine(`[${obj.mode[0].toUpperCase()}]`, obj.time, obj.pid, obj.src, obj.text);
  }
  return list;
}
async function waitForLogFileUpdate(cursor = 0, pids = [], modes = ['manager']) {
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
