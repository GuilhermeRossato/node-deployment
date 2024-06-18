// @ts-check
import path from "path";
import { spawnBackgroundChild } from "../lib/spawnBackgroundChild.js";
import { printPreviousLogs } from "../lib/printPreviousLogs.js";
import { waitForLogFileUpdate } from "../lib/waitForLogFileUpdate.js";

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
  if (options.dry) {
    const description = 'Spawning "--process" child';
    console.log(
      `Skipping side effect (dry-run enabled): ${description}`
    );
    return;
  }
  await Promise.all([
    waitForLogFileUpdate(cursor, pids, ['process']),
    spawnBackgroundChild(exe, args, childCwd, options.sync),
  ]);
}

