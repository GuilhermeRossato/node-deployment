import path from "path";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import sleep from "../utils/sleep.js";
import { waitForLogFileUpdate } from "../logs/waitForLogFileUpdate.js";
import { executeProcessPredictably } from "./executeProcessPredictably.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import { outputLogEntry } from "../logs/outputDatedLine.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import { isProcessRunningByPid } from "./isProcessRunningByPid.js";

export async function spawnManagerProcess(debug = false, detached = true) {
  const logs = await getLastLogs(['mana']);
  const pids = new Set();
  const list = logs.list.filter((f) => ["mana"].includes(path.basename(f.file).substring(0, 4)));
  console.log(`Spawning manager script for ${JSON.stringify(logs.projectPath)}`, debug ? "in debug mode" : "");

  let cursor = 0;
  const last = list[list.length - 1];
  if (last) {
    cursor = last.time;
    console.log(
      `Latest log file "${path.basename(last.file)}" was updated ${getIntervalString(
        new Date().getTime() - last.time
      )} ago (at ${getDateTimeString(last.time)})`
    );
    await sleep(200);
    let i = Math.max(0, list.length - (debug ? 10 : 2));
    process.stdout.write(`  Displaying ${list.length - i} logs:\n`);
    await sleep(200);
    process.stdout.write("\n");
    await sleep(200);
    for (i=i; i < list.length; i++) {
      const obj = list[i];
      pids.add(obj.pid);
      outputLogEntry(obj.file.substring(obj.file.length - 20).padStart(20), obj);
    }
    process.stdout.write("\n");
    await sleep(200);
    if (debug && i === list.length - 1) {
      console.log("Last log object:", last);
    }
    process.stdout.write("\n");
    await sleep(200);
    const runs = await isProcessRunningByPid(last.pid);
    if (runs) {
      console.log("This log was written by a process currently in execution at pid", last.pid);
    }
  } else {
    console.log("There are no manager log files");
  }

  const cwd = logs.projectPath;
  const program = process.argv[0];
  const script = process.argv[1];
  const args = [script, "--manager"];
  if (debug) {
    args.push("--debug");
  }
  console.log(`Spawning manager script "${path.basename(script)}" with ${args.length - 1} arguments`);
  debug && console.log(`${detached ? "Detached" : "Syncronous"} manager execution args:`, args.slice(1));

  process.stdout.write("\n");
  const exec = executeWrappedSideEffect('Spawning "--manager" child', async () => {
    return await spawnChildScript(program, args, cwd, detached);
  });
  const wait = executeWrappedSideEffect('Waiting for "manager" logs', async () => {
    return await waitForLogFileUpdate(cursor, [], ["mana"]);
  });
  await Promise.all([exec, wait]);
  await sleep(200);
  let success = false;
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    try {
      const response = await sendInternalRequest("manager", "status");
      if (response.ok && !response.error) {
        success = true;
        break;
      }
      if (response?.error && typeof response.error === "string") {
        throw new Error(response.error);
      }
    } catch (err) {
      if (i === 0) {
        console.log("First status check after starting failed");
        debug && console.log("[debug]", "Request exception:", err);
      }
      if (i === 10) {
        console.log("Status check failed 10 times after starting manager script");
        debug && console.log("[debug]", "Request exception:", err);
      }
      if (i === 30) {
        console.log("Status check failed 30 times after starting manager script");
        console.log("Request error:", err);
      }
      // ignore
    }
  }
  if (!success) {
    throw new Error("Failed during manager script start: no status response after spawn");
  }
}

async function spawnChildScript(program, args, cwd, detached) {
  await sleep(500);
  return await executeProcessPredictably([program, ...args], cwd, {
    detached,
  });
}
