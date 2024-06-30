import path from "node:path";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import { spawnManagerProcess } from "../process/spawnManagerProcess.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import { outputLogEntry } from "../logs/outputDatedLine.js";
import { readPidFile } from "../lib/readWritePidFile.js";
import sleep from "../utils/sleep.js";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initStatus(options) {
  let res;

  if (options.shutdown || options.restart) {
    console.log("Sending shutdown request...");
    await executeWrappedSideEffect("Spawn manager server", async () => {
      res = await sendInternalRequest("manager", "shutdown");
      options.debug && console.log("Shutdown response:", res);
    });
    if (options.shutdown && !options.start && !options.restart && options.mode !== "logs") {
      options.debug && console.log("Status script finished (after shutdown)");
      return;
    }
  }

  if (options.shutdown || options.restart) {
    console.log("Spawning manager process...");
    await executeWrappedSideEffect("Spawn manager server", async () => {
      await spawnManagerProcess(options.debug, !options.sync);
    });
  }
  let read = {
    time: NaN,
    pid: null,
    running: false,
    path: "",
  };
  {
    const root = options.dir || process.cwd();
    let deploy = await checkPathStatus([root, process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
    if (!deploy.type.dir) {
      deploy = await checkPathStatus([root, ".git", process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
    }
    if (deploy.type.dir) {
      read = await readPidFile("manager");
    } else {
      console.log("Warning: The repository deployment folder was not found at this project");
    }
  }
  if (read.running) {
    console.log("Requesting status from manager process server with pid", read.pid);
    res = await sendInternalRequest("manager", "status");
    if (res.error && res.stage === "network") {
      console.log("Could not connect to internal manager process server");
    } else if (res.error) {
      console.log("Failed to request from the internal manager process server:");
      console.log(options.debug ? res : res.error);
    } else {
      console.log("Status response:");
      for (const line of JSON.stringify(res, null, "  ").split("\n")) {
        console.log(line);
      }
    }
  } else {
    console.log("The manager process is not currently in execution");
    if (options.restart || options.start) {
      console.log("Attempting to start the manager process", options.sync ? "syncronously..." : "...");
      await spawnManagerProcess(options.debug, !options.sync);
      console.log("Spawn manager process resolved");
      res = null;
    } else {
      console.log('To start the manager process use the "--start" argument');
      console.log('You can also restart it with "--restart" or stop it with "--shutdown"');
      return;
    }
  }
  if (!res) {
    await sleep(300);
    console.log("Requesting status from the manager process again...");
    await sleep(300);
    res = await sendInternalRequest("manager", "status");
    console.log(res);
  }
  if (res?.error && res.stage === "network") {
    console.log("Could not connect to internal server (Manager server is offline)");
    await sleep(500);
    console.log("Loading latest manager process logs...");

    const logs = await getLastLogs(["mana"]);
    const list = logs.list.filter((f) => ["mana"].includes(path.basename(f.file).substring(0, 4)));
    if (list.length === 0) {
      console.log("Could not find any manager log entry to display");
    } else {
      console.log(`Loaded ${list.length} log entries from ${JSON.stringify(logs.projectPath)}`);
      for (let i = Math.max(0, list.length - 15); i < list.length - 1; i++) {
        const obj = list[i];
        outputLogEntry(obj.file.substring(obj.file.length - 20).padStart(20), obj);
      }
    }
  }
  console.log("Status mode finished");
}
