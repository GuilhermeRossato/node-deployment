import fs from "fs";
import path from "path";
import child_process from "child_process";
import createInternalServer from "../utils/createInternalServer.js";
import { readPidFile } from "../lib/readWritePidFile.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
import sleep from "../utils/sleep.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import { writePidFile } from "../lib/readWritePidFile.js";
import { killProcessByPid } from "../process/killProcessByPid.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { getLogFileStatus } from "../logs/readLogFile.js";
import { getLastLogs } from "../logs/getLastLogs.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import { getRepoCommitData } from "../lib/getRepoCommitData.js";
import { executeProcessPredictably } from "../process/executeProcessPredictably.js";
import { getInstancePathStatuses } from "../lib/getInstancePathStatuses.js";
import { sendInternalRequest, getManagerHost } from "../lib/sendInternalRequest.js";
import { getParsedProgramArgs } from "../lib/getProgramArgs.js";
import { execProcCheckout } from "./processMode.js";
let lastPid = 0;
let instancePath = "";
let terminating = false;
let stopping = false;
let child = null;
let server = null;

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initManager(options) {
  if (options.dry) {
    console.log('Warning: The manager process ignores the "dry" parameter');
  }
  const root = options.dir || process.cwd();
  const deployFolderPath = path.resolve(root, process.env.DEPLOYMENT_FOLDER_NAME || "deployment");
  if (!fs.existsSync(deployFolderPath)) {
    throw new Error(
      `Cannot start manager because deployment folder was not found at ${JSON.stringify(deployFolderPath)}`
    );
  }
  if (options.port && process.env.INTERNAL_DATA_SERVER_PORT !== options.port) {
    process.env.INTERNAL_DATA_SERVER_PORT = options.port;
    const envFilePath = path.resolve(deployFolderPath, ".env");
    if (!fs.existsSync(envFilePath)) {
      throw new Error(`Cannot start manager because config file was not found at ${JSON.stringify(envFilePath)}`);
    }
    let text = await fs.promises.readFile(envFilePath, "utf-8");
    if (!text.endsWith("\n")) {
      text = `${text}\n`;
    }
    if (!text.includes("INTERNAL_DATA_SERVER_PORT=")) {
      console.log(`Applying "port" parameter (${options.port}) to config file`);
      text = `${text}INTERNAL_DATA_SERVER_PORT=${options.port}\n`;
      if (!options.dry) {
        await fs.promises.writeFile(envFilePath, text, "utf-8");
      }
      console.log("Updated config file at:", JSON.stringify(envFilePath.replace(/\\/g, "/")));
    }
  }
  const { host, port, hostname } = getManagerHost();
  const verifyStatus = await sendInternalRequest(hostname, "status");
  if (!verifyStatus.error) {
    console.log("Existing manager script from", JSON.stringify(hostname), "already exists");
    console.log("Existing manager replied:", JSON.stringify(verifyStatus));
    await sleep(1000);
    console.log("Will attempt to listen to", JSON.stringify(hostname), "even though it seems to exist");
    await sleep(1000);
    console.log(`Attempting to create internal server at ${JSON.stringify(hostname)}...`);
    await sleep(1000);
  } else {
    console.log(`Creating internal server at ${JSON.stringify(hostname)}...`);
    await sleep(300);
  }
  try {
    const result = await createInternalServer(host, port, handleRequest);
    server = result.server;
  } catch (err) {
    console.log(`Failed while creating internal server at ${JSON.stringify(hostname)}`);
    console.log(err);
    await sleep(300);
    process.exit(1);
  }
  await sleep(300);
  console.log(`Manager process is successfully listening at http://${host}:${port}/`);
  console.log("Writing manager pid file with", process.pid);
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

  console.log(`Manager process is ready to start instance child`);

  const data = await getRepoCommitData(options.dir);
  if (data?.hash) {
    try {
      console.log("Current child commit hash:", data.hash);
      let paths = await getInstancePathStatuses();
      const curr = paths.curr;
      if (!curr || !curr.path) {
        console.log(`Wont start current instance because it is invalid: ${JSON.stringify(curr)}`);
      } else if (!curr.type.dir) {
        console.log(`Wont start current instance because it does not exist at: ${JSON.stringify(curr.path)}`);
      }
      if (!curr || !curr.path || !curr.type.dir) {
        console.log("You must run the processor for the project before it can start");
        console.log(
          'To start the project instance process for the first time run this script with the "--processor" argument'
        );
        console.log("(Skipping instance initialization because there are no project versions available)");
      } else {
        if (curr && curr.path && curr.type.dir) {
          console.log("Starting project instance child...");
          const result = await startInstanceChild(data.hash);
          console.log("Start project instance child result:");
          console.log(result);
        }
      }
    } catch (err) {
      console.log("Start instance child failed:");
      console.log(err);
    }
  } else {
    console.log("Cannot start instance process because loading repository data failed:");
    console.log(data);
  }
}

async function startInstanceChild(hash = "") {
  let paths = await getInstancePathStatuses();
  const curr = paths.curr;
  if (!curr || !curr.path) {
    console.log(`Wont start current instance because it is invalid: ${JSON.stringify(curr)}`);
    throw new Error("Invalid current instance path");
  } else if (!curr.type.dir) {
    console.log(`Wont start current instance because it does not exist at: ${JSON.stringify(curr.path)}`);
    throw new Error("Invalid current instance path");
  } else if (!curr.children.length) {
    console.log(`Wont start current instance because it is an empty directory at: ${JSON.stringify(curr.path)}`);
    throw new Error("Invalid empty current instance path");
  }
  let main = "";
  let pkg = {};
  if (curr.children.includes("package.json")) {
    const pkgText = await asyncTryCatchNull(fs.promises.readFile(path.resolve(curr.path, "package.json"), "utf-8"));
    if (pkgText && typeof pkgText === "string" && pkgText.length > 2 && pkgText.trim().startsWith("{")) {
      try {
        pkg = JSON.parse(pkgText);
        main = path.resolve(curr.path, pkg.main ? pkg.main : "index.js");
      } catch (err) {
        console.log("Failed to parse package.json at:", JSON.stringify(curr.path), err.message);
      }
    } else {
      console.log("Failed to read package.json at:", JSON.stringify(curr.path));
    }
  }
  if (!main && curr.children.includes("index.js")) {
    main = path.resolve(curr.path, "index.js");
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
    main = path.resolve(curr.path, curr.children.find((f) => f.endsWith(".js")) || "index.js");
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
  const logs = await getLogFileStatus(path.dirname(paths.deploy.path), "instance");
  if (!logs.parent) {
    console.log("Creating instance log folder at:", JSON.stringify(path.dirname(logs.path)));
    await fs.promises.mkdir(path.dirname(logs.path), { recursive: true });
  }
  console.log(logs.type.file ? "Existing" : "Target", "log file path:", JSON.stringify(logs.path));
  await new Promise((resolve, reject) => {
    console.log("Starting instance process:", cmd.includes('"') || cmd.includes("\\") ? cmd : cmd.split(" "));
    console.log("Instance path:", JSON.stringify(curr.path));
    child = child_process.spawn(cmd, {
      cwd: curr.path,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: 0,
    });
    let pidContents = "";
    child.on("error", (err) => {
      console.log("Instance process spawn error:", err);
      reject(err);
    });
    child.on("spawn", () => {
      console.log("Instance process spawned");
      instancePath = curr.path;
      lastPid = child.pid;
      pidContents = child.pid.toString();
      writePidFile("instance", pidContents);
      setTimeout(() => {
        resolve();
      }, 750);
    });
    child.on("exit", async (code) => {
      console.log("Instance process exited with code:", code);
      if (pidContents) {
        try {
          const read = await readPidFile("instance");
          if ((read.pid || 0).toString() === pidContents) {
            console.log("Removing instance pid file at " + read.path);
            await fs.promises.unlink(read.path);
          }
        } catch (err) {
          console.log("Failed while removing instance pid file:", err);
        }
      }
      reject(new Error(`Child exited with code ${code}`));
    });
    let isFirstData = true;
    const persistData = (data) => {
      try {
        const text = data
          .toString()
          .split("\n")
          .map((a) => getDateTimeString() + " - " + a)
          .join("\n");
        if (isFirstData) {
          isFirstData = false;
          const { options } = getParsedProgramArgs();
          if (options.debug) {
            console.log("Instance process first output:", text);
          }
        }
        logs.path && fs.appendFileSync(logs.path, text, "utf-8");
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
    cwd: curr.path,
    logs: logs.path,
  };
}

async function handleUpgradeRequest(next) {
  console.log("Retrieving instance path statuses...");
  const paths = await getInstancePathStatuses();
  console.log("Instance path status:", JSON.stringify(paths, null, "  "));
  if (paths.curr.type.dir) {
    const bkpInstancePath = `${paths.curr.path}-bkp`;
    const bkp = await checkPathStatus(bkpInstancePath);
    if (bkp.type.dir) {
      console.log("Removing backup instance folder at", bkpInstancePath);
      process.stdout.write("\n");
      const result = await executeProcessPredictably(`rm -rf "${bkpInstancePath}"`, path.dirname(bkpInstancePath), {
        timeout: 10_000,
        shell: true,
        output: "inherit",
      });
      console.log(result);
      await sleep(500);
    }
    console.log("Creating current instance backup from", paths.curr.path);
    process.stdout.write("\n");
    const result = await executeProcessPredictably(
      `mv -f "${paths.curr.path}" "${bkpInstancePath}"`,
      path.dirname(paths.curr.path),
      { timeout: 10_000, shell: true, output: "inherit" }
    );
    console.log("Moved current instance to", bkpInstancePath);
    console.log(result);
    await sleep(500);
  }
  const verify = await checkPathStatus(paths.curr.path);
  if (verify.type.dir) {
    console.log("Current instance exists at", verify.path);
  }
  if (next.type.dir) {
    const cwd = path.dirname(paths.curr.path);
    const cmd = `mv -f "${next.path}" "${paths.curr.path}"`;
    console.log("Moving next instance files to", paths.curr.path);
    //console.log("Moving cmd:", cmd);
    //console.log("Moving cwd:", cwd);
    process.stdout.write("\n");
    const result = await executeProcessPredictably(cmd, cwd, { timeout: 10_000, shell: true, output: "inherit" });
    console.log("Move result");
    console.log(result);
    console.log(
      result.exit === 0 ? "Successfully" : "Failed to",
      "replaced the current instance folder with next instance folder"
    );
    await sleep(500);
  }
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
  console.log("Handling", method, url);
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
    const nextPath = data ? data.nextInstancePath : null;
    if (nextPath) {
      const next = await checkPathStatus(nextPath);
      console.log(
        `New instance request with path ${JSON.stringify(next.name)} ${next.type.dir ? "exists" : "does not exist"}`
      );
      if (!next.parent) {
        console.log("The new instance path parent was not found at", JSON.stringify(next.path));
        throw new Error("Could not upgrade instance");
      } else if (!next.type.dir) {
        console.log("The new instance path was not found at", JSON.stringify(next.name));
        throw new Error("Could not upgrade instance");
      } else if (!next.children.length) {
        console.log("The new instance path is empty at", JSON.stringify(next.path));
        throw new Error("Could not upgrade instance");
      } else {
        console.log("Upgrading instance from", JSON.stringify(next.path));
        try {
          await handleUpgradeRequest(next);
        } catch (err) {
          console.log("Failed while handling new instance version request:", err);
          throw new Error("Could not upgrade instance");
        }
      }
    }
    console.log("Spawning instance process...");
    let status = "";
    const promise = startInstanceChild();
    promise
      .then((r) => {
        status = "resolved";
        if (r && r.logs) {
          console.log("Project instance log file:", r.logs);
          delete r.logs;
        }
        console.log("Instance spawn result", r);
      })
      .catch((e) => {
        status = "failed";
        console.log("Instance spawn error", e);
      });
    await sleep(1000);
    if (status !== "") {
      console.log("Note: Instance process", status, "imediately after spawn");
    }
    const logs = await getLastLogs(["instance"]);
    const pres = await getRunningChildInstanceProcess();
    const pid = pres.pid || lastPid;
    const runs = pid ? await isProcessRunningByPid(pid) : false;
    console.log("Verifying instance pid from", JSON.stringify(pres.source), runs ? "(running)" : "(not running)");
    const paths = await getInstancePathStatuses();
    return {
      success: true,
      reason: `${url === "/api/restart" ? "Restarted" : "Started"} instance process`,
      current: paths.curr.path,
      previous: paths.prev.path,
      running: runs,
      pid,
      logs: logs.list.slice(Math.max(0, logs.list.length - 30)).map((a) => `${getDateTimeString(a.time)} ${a.text}`),
    };
  }
  if (url === "/api/logs") {
    const logs = await getLastLogs();
    const list = logs.list.map((a) => ({
      ...a,
      time: undefined,
      src: a.src ? a.src : undefined,
      pid: a.pid ? a.pid : undefined,
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
      src: a.src ? a.src : undefined,
      pid: a.pid ? a.pid : undefined,
      date: getDateTimeString(new Date(a.time)),
      file: path.basename(a.file),
    }));
    const iLogs = list.filter((f) => f.file.startsWith("instance"));
    const dLogs = list.filter((f) => !f.file.startsWith("instance"));
    const { hostname } = getManagerHost();
    return {
      success: true,
      path: logs.projectPath,
      hostname,
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
        uptime: getIntervalString(process.uptime() * 1000),
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
