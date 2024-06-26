import fs from "fs";
import path from "path";
import child_process from "child_process";
import createInternalDataServer from "../utils/createInternalServer.js";
import { getPidFileStatus, readPidFile } from "../lib/readWritePidFile.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
import sleep from "../utils/sleep.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import { writePidFile } from "../lib/readWritePidFile.js";
import { killProcessByPid } from "../process/killProcessByPid.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { getParsedProgramArgs } from "../lib/getProgramArgs.js";
import { getLogFileStatus } from "../logs/readLogFile.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import { getRepoCommitData, executeGitCheckout } from "../lib/getRepoCommitData.js";
let instancePath = "";
let terminating = false;
let stopping = false;
let child = null;
let server = null;

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initManager(options) {
  console.log("Starting manager...");
  const host = process.env.INTERNAL_DATA_SERVER_HOST || "127.0.0.1";
  const port = process.env.INTERNAL_DATA_SERVER_PORT || "49737";

  console.log(`Creating internal server at http://${host}:${port}/...`);
  await sleep(300);
  const result = await createInternalDataServer(host, port, handleRequest);
  await sleep(300);
  console.log(`Manager process is successfully listening at http://${host}:${port}/`);
  server = result.server;
  console.log("Writing manager pid file...");
  const expected = process.pid.toString().trim();
  await writePidFile("manager", expected);
  await sleep(500 + Math.random() * 500);
  {
    const read = await readPidFile("manager");
    const written = (read.pid || "").toString().trim();
    if (expected !== written) {
      console.log("Unexpected manager process pid file contents at:", JSON.stringify(read.path));
      console.log("Pid file contents:", JSON.stringify(written), "expected:", JSON.stringify(expected));
    }
  }

  console.log(`Manager process is ready`);

  let t;
  t = setInterval(async () => {
    const read = await readPidFile("manager");
    const written = (read.pid || "").toString().trim();
    if (expected !== written) {
      console.log("Manager process detected update on pid file at:", JSON.stringify(read.path));
      console.log("Unexpected pid file contents:", JSON.stringify(written), "expected:", JSON.stringify(expected));
      clearInterval(t);
    }
  }, 30_000);
  const data = await getRepoCommitData(options.dir);
  if (data.hash) {
    const result = await startInstanceChild(data.hash);
    console.log("Start instance child result:");
    console.log(result);
  }
}

async function startInstanceChild(hash = "") {
  const { options } = getParsedProgramArgs(false);
  const root = options.dir || process.cwd();
  const currInstancePath = path.resolve(
    root,
    process.env.CURR_INSTANCE_FOLDER_PATH || process.env.INSTANCE_FOLDER_PATH || "current-instance"
  );
  let status = await checkPathStatus(currInstancePath);
  if (!status.type.dir) {
    console.log(`Creating instance folder at "${status.path}"`);
    await fs.promises.mkdir(status.path, { recursive: true });
    status = await checkPathStatus(currInstancePath);
  }
  if (!status.type.dir) {
    throw new Error(`Invalid instance folder: "${status.path}"`);
  }
  if (!status.children.length) {
    console.log(`Executing checkout from "${root}"...`);
    const result = await executeGitCheckout(root, currInstancePath, hash || options.ref);
    if (result.error || result.exit !== 0) {
      throw new Error(
        `Failed to checkout to instance folder: ${JSON.stringify({
          result,
        })}`
      );
    } else {
      console.log("Checkout successfull");
    }
    status = await checkPathStatus(currInstancePath);
  }
  let main = "";
  let pkg = {};
  if (status.children.includes("package.json")) {
    const pkgText = await asyncTryCatchNull(fs.promises.readFile(path.resolve(status.path, "package.json"), "utf-8"));
    if (pkgText && typeof pkgText === "string" && pkgText.length > 2 && pkgText.trim().startsWith("{")) {
      try {
        pkg = JSON.parse(pkgText);
        main = path.resolve(status.path, pkg.main);
      } catch (err) {
        console.log("Failed to parse package.json at:", JSON.stringify(status.path), err.message);
      }
    } else {
      console.log("Failed to read package.json at:", JSON.stringify(status.path));
    }
  }
  if (!main && status.children.includes("index.js")) {
    main = path.resolve(status.path, "index.js");
  }
  const scripts = pkg && pkg.scripts ? Object.keys(pkg.scripts) : [];
  let type = "";
  let cmd = process.env.PIPELINE_STEP_START || "";
  if (!cmd && scripts.includes("start")) {
    cmd = `npm run start`;
    type = "npm command";
  }
  if (!cmd && main) {
    const check = await checkPathStatus(main);
    if (check.type.file) {
      cmd = `node ${main}`;
      type = "node script";
    } else {
      console.log("Warning: Cannot find project main script at", JSON.stringify(main));
    }
  }
  if (!cmd && scripts.length) {
    const name =
      scripts.find((l) => l.startsWith("prod")) || scripts.find((l) => l.endsWith("start") || l.startsWith("start"));
    if (name) {
      cmd = `npm run ${name}`;
      type = "npm command";
    }
  }
  if (!cmd) {
    main = path.resolve(status.path, status.children.find((f) => f.endsWith(".js")) || "index.js");
    cmd = `node ${main}`;
    type = "node script";
  }
  if (cmd.startsWith("node ")) {
    cmd = `${process.argv[0]} ${cmd.substring(cmd.indexOf(" ") + 1)}`;
    type = "node script";
  }
  if (!type && cmd.startsWith("npm ")) {
    type = "npm command";
  } else if (!type && cmd.startsWith("yarn ")) {
    type = "yarn command";
  } else if (!type) {
    const prefix = cmd.substring(0, cmd.indexOf(" ")).replace(/\\/g, "/");
    type = `${prefix.substring(prefix.lastIndexOf("/") + 1)} command`;
  }
  console.log("Instance command type:", JSON.stringify(type));
  const logs = await getLogFileStatus(root, "instance");
  if (!logs.parent) {
    console.log("Creating instance log folder at:", JSON.stringify(path.dirname(logs.path)));
    await fs.promises.mkdir(path.dirname(logs.path), { recursive: true });
  }
  console.log(logs.type.file ? "Existing" : "Upcoming", "log file path:", JSON.stringify(logs.path));
  await new Promise((resolve, reject) => {
    console.log("Starting instance process:", cmd.includes('"') || cmd.includes("\\") ? cmd : cmd.split(" "));
    child = child_process.spawn(cmd, {
      cwd: status.path,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let pidContents = "";
    child.on("error", (err) => {
      console.log("Instance process spawn error:", err);
      reject(err);
    });
    child.on("spawn", () => {
      console.log("Instance process spawned");
      instancePath = status.path;
      pidContents = child.pid.toString();
      writePidFile("instance", pidContents);
      setTimeout(() => {
        resolve();
      }, 1000);
    });
    child.on("exit", async (code) => {
      console.log("Instance process exited with code:", code);
      if (pidContents) {
        try {
          const read = await readPidFile("instance");
          if (read.pid.toString() === pidContents) {
            console.log("Removing instance pid file at " + read.path);
            await fs.promises.unlink(read.path);
          }
        } catch (err) {
          console.log("Failed while removing instance pid file:", err);
        }
      }
      reject(new Error(`Child exited with code ${code}`));
    });
    const persistData = (data) => {
      try {
        logs.path && fs.appendFileSync(logs.path, data);
      } catch (err) {
        console.log("Failed to write to log file at", JSON.stringify(logs.path), ":", err);
        logs.path = "";
      }
    };
    child.stdout.on("data", persistData);
    child.stderr.on("data", persistData);
  });
  return {
    pid: child && typeof child.pid === "number" && child.pid ? child.pid : null,
    cmd,
    cwd: status.path,
    logs: logs.path,
  };
}

async function handleRequest(url, method, data) {
  if (url === "/favicon.ico" || url[1] === ".") {
    return {
      success: false,
      status: 404,
      error: "Not found",
    };
  }
  if (url !== "/" && url.endsWith("/")) {
    url = url.substring(0, url.length - 1);
  }
  console.log("Handling", method, "request", url);
  if (url === "/" || url === "/api" || url === "/api/help" || url === "/api/info") {
    return {
      name: "Node Deployment Manager Server",
      routes: {
        "/api/status": "Retrieve status from the project instance process and deployment status",
        "/api/logs": "Display the latest logs from the project instance and the deployment",
        "/api/shutdown": "Terminate the project instance process",
        "/api/start": "Starts the project instance if it is not executing",
        "/api/restart": "Stop and restart the project instance process",
        "/api/terminate": "Terminate the project instance and the manager server process",
      },
    };
  }
  if (url === "/api/stop" || url === "/api/shutdown" || url === "/api/terminate") {
    const target = url === "/api/stop" ? "instance" : "manager";
    if ((target === "instance" && stopping) || (target === "manager" && terminating)) {
      return { success: true, reason: `The ${target} process is currently being stopped` };
    }
    if (method !== "POST") {
      return { success: false, reason: "Invalid request method (expected POST)" };
    }
    let read = await readPidFile("instance");
    if (!read.running && child && child.pid && typeof child.pid === "number") {
      read.pid = child.pid;
      read.running = await isProcessRunningByPid(child.pid);
    }
    if (target === "instance" && !read.running) {
      return {
        success: true,
        reason: "Instance process is not running",
        details: read.pid ? `The instance process "${read.pid}" is not running` : "The instance pid file was not found",
      };
    }
    if (target === "instance") {
      stopping = true;
    } else if (target === "manager") {
      terminating = true;
    }
    try {
      const result = await executeTerminationRequest(target, data?.exit || 0);
      console.log(
        "Result from termination",
        result === true ? "was successfull" : result === false ? "was false" : "is unexpected"
      );
      if (target === "instance") {
        stopping = false;
      }
      return { success: true, reason: `The ${target} process will be stopped` };
    } catch (err) {
      if (target === "instance") {
        stopping = false;
      } else if (target === "manager") {
        terminating = false;
      }
      return { success: false, reason: `Failed at termination: ${err.message}`, stack: err.stack };
    }
  }
  if (url === "/api/start" || url === "/api/restart") {
    let read = await readPidFile("instance");
    if (!read.running && child && child.pid && typeof child.pid === "number") {
      read.pid = child.pid;
      read.running = await isProcessRunningByPid(read.pid);
    }
    if (url === "/api/restart" && read.running) {
      console.log("Stopping instance process with pid", read.pid, "to restart");
      stopping = true;
      try {
        const result = await executeTerminationRequest("instance", 0);
        console.log("Termination result:", result);
        stopping = false;
        await sleep(300);
      } catch (err) {
        stopping = false;
        return { success: false, reason: `Failed at termination: ${err.message}`, stack: err.stack };
      }
    }
    console.log("Spawning instance process...");
    const childResult = await startInstanceChild();
    console.log("Child spawn result", childResult);
    await sleep(500);
    const pres = await getRunningChildInstanceProcess();
    const runs = pres.pid ? await isProcessRunningByPid(pres.pid) : false;
    console.log("Verifying instance pid from", pres.source, ":", pres.pid, runs ? "(running)" : "(not running)");
    if (!runs) {
      return { error: "Failed to start instance server" };
    }
    return {
      success: true,
      reason: "Started instance folder",
      logs: "/api/logs",
      pid: pres.pid,
      cwd: childResult.cwd,
      cmd: childResult.cmd,
    };
  }
  if (url === "/api/logs") {
    const logs = await getLastLogs();
    const list = logs.list.map((a) => ({
      ...a,
      time: undefined,
      date: getDateTimeString(new Date(a.time)),
      file: path.basename(a.file),
    }));
    const last = logs.list[logs.list.length - 1];
    return {
      success: true,
      last: last
        ? {
            text: last.text,
            interval: getIntervalString(new Date().getTime() - last.time),
            file: last.file,
            date: getDateTimeString(new Date(last.time)),
            src: last.src,
          }
        : undefined,
      logs: list,
      files: logs.names,
    };
  }
  if (url === "/api/status") {
    let read = await readPidFile("instance");
    if (!read.running && child && child.pid && typeof child.pid === "number") {
      read.pid = child.pid;
      read.running = await isProcessRunningByPid(child.pid);
    }
    const pread = await readPidFile("processor");

    const logs = await getLastLogs();
    const list = logs.list.map((a) => ({
      ...a,
      time: undefined,
      date: getDateTimeString(new Date(a.time)),
      file: path.basename(a.file),
    }));
    const iLogs = list.filter((f) => f.file.startsWith("instance"));
    const dLogs = list.filter((f) => !f.file.startsWith("instance"));
    return {
      success: true,
      path: logs.projectPath,
      instance: {
        pid: read.pid,
        status: read.running ? "running" : "not-running",
        path: instancePath,
        logs: iLogs.slice(Math.max(0, iLogs.length - 3)),
      },
      deployment: {
        pid: process.pid,
        status: pread.running ? "in-progress" : "idle",
        path: logs.projectPath,
        logs: dLogs.slice(Math.max(0, dLogs.length - 3)),
      },
    };
  }
  return { error: "Unhandled url", url };
}

async function getRunningChildInstanceProcess() {
  try {
    const isChildRunning =
      child && child.pid && typeof child.pid === "number" && (await isProcessRunningByPid(child.pid));
    if (isChildRunning) {
      return { pid: child.pid, source: "child-instance" };
    }

    const read = await readPidFile("instance");
    const isPidFileRunning =
      read && read.pid && typeof read.pid === "number" && (await isProcessRunningByPid(read.pid));
    if (isPidFileRunning) {
      return { pid: child.pid, source: "pid-file" };
    } else if (read.pid) {
      return { pid: 0, source: "pid-file" };
    } else if (child && child.pid && typeof child.pid === "number") {
      return { pid: 0, source: "child-instance" };
    } else {
      return { pid: undefined, source: "child-instance" };
    }
  } catch (err) {
    throw new Error("Failed while getting instance pid: " + err.message);
  }
  throw new Error("Failed while getting instance pid");
}

/**
 * @param {'instance' | 'manager'} [target]
 * @param {number} code
 */
async function executeTerminationRequest(target = "instance", code = 1) {
  if (target === "manager" && server) {
    console.log(`Closing internal manager server`);
    try {
      if (server?.end) {
        await server.end();
      }
      if (server?.close) {
        await server.close();
      }
      server = null;
    } catch (err) {
      console.log("Failed while closing instance manager http server:", err);
      await sleep(500);
    }
  }
  console.log("Fetching instance child process id...");
  const res = await getRunningChildInstanceProcess();
  let runs = res.pid ? await isProcessRunningByPid(res.pid) : false;
  console.log("Retrieved instance pid from", res.source, ":", res.pid, runs ? "(running)" : "(not running)");
  if (runs) {
    const list = ["sigint", "sigterm", "kill", "force"];
    for (let i = 0; i < list.length; i++) {
      /** @type {any} */
      const kind = list[i];
      console.log(`Stop attempt ${i}: Terminating child process ${res.pid} with "${kind.toUpperCase()}"`);
      await sleep(200);
      const result = await killProcessByPid(res.pid, kind);
      await sleep(200);
      console.log("Attempt result:", result);
      for (let j = 0; j < 10; j++) {
        await sleep(50);
        runs = await isProcessRunningByPid(res.pid);
        if (!runs) {
          break;
        }
      }
      if (!runs) {
        console.log(`Instance stopped with "${kind.toUpperCase()}" ${i}/${list.length}`);
        break;
      }
    }
    runs = await isProcessRunningByPid(res.pid);
    if (runs) {
      const message = `Instance child could not be terminated and is still running as ${res.pid}`;
      if (target === "instance") {
        throw new Error(message);
      } else {
        console.log(message);
      }
    } else {
      console.log(`Instance child process successfully terminated`);
      if (target === "instance") {
        return true;
      }
    }
  } else if (!res.pid) {
    console.log("Could not find any valid instance process id to stop");
  } else {
    console.log("The instance process cannot be stopped because it is not executing");
    if (target === "instance") {
      return true;
    }
  }
  if (target !== "manager") {
    return false;
  }
  console.log("Manager process will start the timer to exit with code", code);
  setTimeout(() => process.exit(code), 200);
  return true;
}
