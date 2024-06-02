// @ts-check
import path from "path";
import { deployRepositoryFolderPath, processorLog, syncronousScheduler } from "../config.mjs";
import { getLatestLogs } from "./lib/getLatestLogs.mjs";
import { spawnBackgroundChild } from "./lib/spawnBackgroundChild.mjs";
import { waitForLogFileUpdate } from "./lib/waitForLogFileUpdate.mjs";
import { getDebugLog } from "./lib/getDebugLog.mjs";
import {  } from "../config.mjs";

const debug = true;
const detached = !syncronousScheduler;

export async function initScheduler() {
  const debugLog = getDebugLog(debug);;
  if (debug) {
    const list = await getLatestLogs();
    const last = list.slice(Math.max(0, list.length - 3));
    if (last.length) {
      console.log("Last logs before start:");
      console.log(last);
    }
  }
  const script = path.resolve(
    deployRepositoryFolderPath,
    "index.mjs"
  );
  const childArgs = [script, '--processor', ...process.argv.slice(2)];
  const childCmd = process.argv[0];
  const childCwd = process.cwd();
  const scriptName = path.basename(childArgs[0]);

  debugLog(
    `Starting "${scriptName}" with ${childArgs.length - 1} arguments`
  );

  debugLog(`Executing: "${childCmd}"`);
  debugLog("Child arg:", childArgs);
  debugLog("Child cwd:", childCwd);

  debug && console.log('Starting processor at background and waiting for log update...');

  await Promise.all([
    waitForLogFileUpdate(processorLog),
    spawnBackgroundChild(childCmd, childArgs, childCwd, detached),
  ]);

  const list = await getLatestLogs(processorLog);

  debugLog(`Last processor logs: ${JSON.stringify(list.slice(list.length - 2))}`);

  debugLog("Finished script");
}
