// @ts-check
import path from "path";
import { waitForLogFileUpdate } from "../logs/waitForLogFileUpdate.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import { outputLogEntry } from "../logs/outputDatedLine.js";
import { executeProcessPredictably } from "../process/executeProcessPredictably.js";
import sleep from "../utils/sleep.js";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import { getRepoCommitData } from "../lib/getRepoCommitData.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initScheduler(options) {
  const debug = options.debug;
  const logs = await getLastLogs(["proc"]);
  const list = logs.list.filter((f) => ["proc"].includes(path.basename(f.file).substring(0, 4)));
  const cwd = logs.projectPath || options.dir || process.cwd();
  console.log(`Scheduling script started for ${JSON.stringify(cwd)}`, debug ? "in debug mode" : "");

  let cursor = 0;
  const last = list[list.length - 1];
  if (last) {
    cursor = last.time;
    console.log(`Latest log file path updated: ${JSON.stringify(path.resolve(last.file).replace(/\\/g, "/"))}`);
    console.log(
      `Latest log update was ${getIntervalString(new Date().getTime() - last.time)} ago (at ${getDateTimeString(
        last.time
      )})`
    );
    await sleep(200);
    let i = Math.max(0, list.length - (debug ? 10 : 2));
    process.stdout.write(`\n  Displaying ${list.length - i} logs:\n`);
    await sleep(200);
    process.stdout.write("\n");
    await sleep(200);
    for (i = i; i < list.length; i++) {
      const obj = list[i];
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
      console.log("The process from last log is executing at pid", last.pid);
    }
  } else {
    console.log("There are no processor log files");
  }

  const program = process.argv[0];
  const script = path.resolve(process.argv[1]);

  const args = [script, "--processor"];
  if (options.ref) {
    args.push(options.ref);
    console.log("Loading ref data for", options.ref);
    const refData = await getRepoCommitData(options.dir, options.ref);
    console.log("Hash", refData.hash, "Ref", options.ref, "\nCommit", getDateTimeString(refData.date), refData.text);
  }
  if (options.debug) {
    args.push("--debug");
  }

  debug && console.log(`Spawning processor script "${path.basename(script)}" with ${args.length - 1} arguments`);
  debug && console.log(`${options.sync ? "Syncronous" : "Detached"} processor execution args:`, args.slice(1));

  const exec = executeWrappedSideEffect('Spawning "--processor" child', async () => {
    return await spawnChildScript(program, args, cwd, !options.sync);
  });
  if (!options.sync) {
    const wait = executeWrappedSideEffect('Waiting for "processor" logs', async () => {
      return await waitForLogFileUpdate(cursor, [], ["proc"]);
    });
    await Promise.all([exec, wait]);
    console.log("Schedule mode finished");
  }
}

async function spawnChildScript(program, args, cwd, detached) {
  await sleep(500);
  return await executeProcessPredictably([program, ...args], cwd, {
    detached,
    output: detached ? "inherit" : "accumulate",
  });
}
