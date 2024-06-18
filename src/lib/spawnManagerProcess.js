import path from 'path';
import { spawnBackgroundChild } from './spawnBackgroundChild.js';
import sendInternalRequest from './sendInternalRequest.js';
import sleep from './sleep.js';
import { printPreviousLogs } from './printPreviousLogs.js';
import { waitForLogFileUpdate } from './waitForLogFileUpdate.js';

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

  const list = await printPreviousLogs(15, ['manager']);
  debug &&
    console.log(
      `Manager has ${list.length} starting logs`
    );
  const cursor = list.length === 0 ? 0 : Math.min(...list.map(a => a.time).filter(a => a > 0));
  const pids = list.map(a => a.pid).filter(a => a > 0);
  await Promise.all([
    waitForLogFileUpdate(cursor, pids, ['manager']),
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
