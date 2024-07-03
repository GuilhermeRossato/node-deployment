// Script built at 2024-07-03T13:59:55.095Z
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const child_process = require("node:child_process");

// ./src/utils/sleep.js
/**
 * Returns a promise that resolves in a specified amount of milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.max(0, ms)))
  );
}
// ./src/utils/loadEnvSync.js
function loadEnvSync(folderList = [], envRecord = {}, whiteList = []) {
  if (folderList.length === 0) {
    folderList.push(process.cwd());
  }
  for (const folder of folderList) {
    try {
      if (!folder || typeof folder !== "string" || !fs.existsSync(folder)) {
        continue;
      }
      const target = fs.statSync(folder).isDirectory() ? path.resolve(folder, ".env") : folder;
      const text = fs.readFileSync(target, "utf-8");
      const list = text.split("\n").reverse();
      for (const line of list) {
        if (!line.trim().length || ["#", "/"].includes(line.trim()[0])) {
          continue;
        }
        const i = line.indexOf("=");
        const key = line.substring(0, i === -1 ? line.length : i).trim();
        if (key.includes(" ") || key.includes("\t")) {
          continue;
        }
        if (whiteList && whiteList.length && !whiteList.includes(key)) {
          continue;
        }
        const value = i === -1 ? "" : line.substring(i + 1);
        if (!envRecord[key] && value) {
          envRecord[key] =
            value.startsWith('"') && value.endsWith('"') ? value.substring(1, value.length - 1) : value.trim();
        }
      }
    } catch (err) {
      continue;
    }
  }
  return envRecord;
}
// ./src/utils/checkPathStatus.js
/**
 * @typedef {Object} PathStatus
 * @property {string} path - The resolved path
 * @property {string} name - The basename of the path
 * @property {Object} type - The type of the path
 * @property {boolean} type.file - Indicates if the path is a file
 * @property {boolean} type.dir - Indicates if the path is a directory
 * @property {boolean} type.bare - Indicates if the path is git bare repository
 * @property {boolean} type.proj - Indicates if the path is configured with this tool
 * @property {string[] | null} children - Name of the children of the path if it is a directory
 * @property {string | null} parent - Parent directory of the path if it exists
 * @property {number | null} mtime - Modified time of the path
 */

/**
 * Check the status of a given path.
 * @param {string | string[] | {path: string} | PathStatus} target
 * @returns {Promise<PathStatus>} The status of the path
 */
async function checkPathStatus(target) {
  /** @type {any[]} */
  let tlist =
    target instanceof Array
      ? target
      : typeof target === "string"
      ? [target]
      : typeof target === "object" && typeof target.path === "string"
      ? [target.path]
      : [""];
  if (tlist.some((t) => typeof t === "object")) {
    tlist = tlist.map((t) => (typeof t === "object" && typeof t.path === "string" && t.path ? t.path : t));
  }
  if (tlist.some((t) => typeof t !== "string")) {
    throw new Error(`Invalid path parts: ${JSON.stringify(tlist)}`);
  }
  target = path.resolve(...tlist);
  const s = {
    path: target.replace(/\\/g, "/"),
    name: path.basename(target),
    type: {
      file: false,
      dir: false,
      bare: false,
      proj: false,
    },
    children: null,
    parent: null,
    mtime: null,
  };
  try {
    await fs.promises.stat(path.dirname(target));
    s.parent = path.dirname(target).replace(/\\/g, "/");
    const stat = await fs.promises.stat(target);
    s.mtime = stat.mtimeMs;
    s.type.dir = stat.isDirectory && stat.isDirectory();
    s.type.file = stat.isFile && stat.isFile();
    s.children = s.type.dir ? await fs.promises.readdir(target) : null;
  } catch (err) {
    s.type.dir = false;
    s.type.file = false;
  }
  if (checkPathStatusContains(s, ["HEAD", "hooks", "config"])) {
    try {
      const config = await fs.promises.readFile(path.resolve(target, "config"), "utf-8");
      s.type.bare = config.replace(/\s/g, "").includes("bare=");
    } catch (err) {
      s.type.bare = false;
    }
    try {
      const deploy = await checkPathStatus([s.path, process.env.DEPLOYMENT_FOLDER_NAME]);
      if (
        deploy.type.dir &&
        s.children instanceof Array &&
        s.children.includes("node-deploy.cjs") &&
        s.children.includes(".env")
      ) {
        s.type.proj = true;
      }
    } catch (err) {
      s.type.proj = false;
    }
  }
  return s;
}

/**
 * Check the status of a given path syncronously
 * @param {string | string[] | {path: string} | PathStatus} target
 * @returns {PathStatus} The status of the path
 */
function checkPathStatusSync(target) {
  /** @type {any[]} */
  let tlist =
    target instanceof Array
      ? target
      : typeof target === "string"
      ? [target]
      : typeof target === "object" && typeof target.path === "string"
      ? [target.path]
      : [""];
  if (tlist.some((t) => typeof t === "object")) {
    tlist = tlist.map((t) => (typeof t === "object" && typeof t.path === "string" && t.path ? t.path : t));
  }
  if (tlist.some((t) => typeof t !== "string")) {
    throw new Error(`Invalid path parts: ${JSON.stringify(tlist)}`);
  }
  target = path.resolve(...tlist);
  const s = {
    path: target.replace(/\\/g, "/"),
    name: path.basename(target),
    type: {
      file: false,
      dir: false,
      bare: false,
      proj: false,
    },
    children: null,
    parent: null,
    mtime: null,
  };
  try {
    fs.statSync(path.dirname(target));
    s.parent = path.dirname(target).replace(/\\/g, "/");
    const stat = fs.statSync(target);
    s.mtime = stat.mtimeMs;
    s.type.dir = stat.isDirectory && stat.isDirectory();
    s.type.file = stat.isFile && stat.isFile();
    s.children = s.type.dir ? fs.readdirSync(target) : null;
  } catch (err) {
    s.type.dir = false;
    s.type.file = false;
  }
  if (checkPathStatusContains(s, ["HEAD", "hooks", "config"])) {
    try {
      const config = fs.readFileSync(path.resolve(target, "config"), "utf-8");
      s.type.bare = config.replace(/\s/g, "").includes("bare=");
    } catch (err) {
      s.type.bare = false;
    }
    try {
      const deploy = checkPathStatusSync([s.path, process.env.DEPLOYMENT_FOLDER_NAME]);
      if (
        deploy.type.dir &&
        s.children instanceof Array &&
        s.children.includes("node-deploy.cjs") &&
        s.children.includes(".env")
      ) {
        s.type.proj = true;
      }
    } catch (err) {
      s.type.proj = false;
    }
  }
  return s;
}

/**
 * @param {PathStatus} status
 */
function checkPathStatusContains(status, children = []) {
  if (!status.type.dir || !(status.children instanceof Array) || status.children.length < children.length) {
    return false;
  }
  if (children.some((child) => !status.children.includes(child))) {
    return false;
  }
  return true;
}
// ./src/utils/getDateTimeString.js
global.tzHrOffset = -(new Date().getTimezoneOffset() / 60)
global.hhOffset = Math.floor(Math.abs(tzHrOffset)).toString()
global.mmOffset = Math.floor(Math.abs(tzHrOffset / 60) % 60)
  .toString()
  .padStart(2, "0");

/**
 * Returns the date time string offseted by the local timezone in YYYY-MM-DD HH:MM:SS.zzz format
 * @param {Date | string | number} date
 * @param {boolean} [includeOffset] (default false) Whether to append the local timezone offset to the end of the date (e.g. " -03:00")
 * @returns {string} "YYYY-MM-DD HH:MM:SS.zzz"
 */
function getDateTimeString(date = new Date(), includeOffset = false) {
  // Obs: This function is frequently used
  if (typeof date === "string" && date.startsWith("20") && date[3] === "-" && date[5] === "-") {
    if (date.length === "2024-04-04 04".length) {
      date = date + ":00:00";
    }
    const ending = date.trim().substring(date.length - 7);
    if (!ending.includes("+") && !ending.includes("-") && !ending.includes("Z") && !ending.includes("G")) {
      const guess = new Date(`${date} ${tzHrOffset < 0 ? "-" : ""}${hhOffset.padStart(2, "0")}:${mmOffset}`);
      if (!isNaN(guess.getTime())) {
        date = guess;
      }
    }
  }
  const d = new Date(date instanceof Date ? date.getTime() : date === undefined ? null : date);
  d.setTime(d.getTime() + tzHrOffset * 60 * 60 * 1000);
  const fullYear = d.getUTCFullYear();
  if (isNaN(fullYear)) {
    throw new Error(`Invalid date: ${JSON.stringify(date)}`);
  }
  const year = fullYear.toString().padStart(4, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const seconds = d.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = d.getUTCMilliseconds().toString().padStart(3, "0").substring(0, 3);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}${
    includeOffset ? ` ${tzHrOffset < 0 ? "-" : ""}${hhOffset.padStart(2, "0")}:${mmOffset}` : ""
  }`;
}
// ./src/utils/asyncTryCatchNull.js
/**
 * Asynchronously attempts to execute a promise and returns the result.
 * If an error is thrown with a code of 'ENOENT', null is returned instead.
 * @template ResponseType
 * @param {Promise<ResponseType>} promise
 * @returns {Promise<ResponseType | null | Error>}
 */
async function asyncTryCatchNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return null;
    }
    return err;
  }
}
// ./src/utils/getIntervalString.js
function getIntervalString(ms) {
  if (typeof ms !== "number" || isNaN(ms)) {
    return "(never)";
  }
  if (ms >= -2000 && ms <= 2000) {
    return `${Math.floor(ms)} ms`;
  }
  const left = ms < 0 ? "-" : "";
  const s = Math.abs(ms / 1000);
  if (s <= 60) {
    return left + (s <= 1.1 ? "1 second" : `${s.toFixed(1)} seconds`);
  }
  const h = Math.floor(s / (60 * 60));
  const m = Math.floor(s / 60);

  if (h <= 0) {
    const right = Math.floor(s) === 0 ? "" : Math.floor(s) === 1 ? "and 1 second" : `and ${Math.floor(s)} seconds`;
    return `${left}${m === 1 ? "1 minute" : `${m} minutes`} ${right}`;
  }
  if (h <= 24) {
    return `${left}${h} hour${h === 1 ? "" : "s"} and ${m % 60} minute${m % 60 === 1 ? "" : "s"}`;
  }
  const days = Math.floor(s / (24 * 60 * 60));
  const sufix = h % 24 === 0 ? "" : h % 24 === 1 ? " and 1 hour" : ` and ${h % 24} hours`;
  return `${left}${days} day${days === 1 ? "" : "s"}${sufix}`;
}
// ./src/lib/sendInternalRequest.js
global.debugReq = true

function getManagerHost(target = "manager") {
  let host = target === "manager" ? process.env.INTERNAL_DATA_SERVER_HOST || "127.0.0.1" : "127.0.0.1";
  let port = target === "manager" ? process.env.INTERNAL_DATA_SERVER_PORT || "49737" : "49738";
  let hostname = `http://${host}:${port}/`;
  if (typeof target === "string" && (target.startsWith("http://") || target.startsWith("https://"))) {
    debugReq && console.log("Request target hostname set to", JSON.stringify(target));
    hostname = target;
    const startHost = hostname.indexOf("//") + 2;
    if (hostname.indexOf(":", 7) !== -1) {
      host = hostname.substring(startHost, hostname.indexOf(":", 7));
      port = hostname
        .substring(hostname.indexOf(":", 7) + 1, hostname.indexOf("/", 7) + 1 || hostname.length)
        .replace(/\D/g, "");
    } else if (hostname.indexOf("/", 7) !== -1) {
      host = hostname.substring(startHost, hostname.indexOf("/", 7));
      port = "80";
    } else {
      host = hostname.substring(startHost, hostname.length);
      port = "80";
    }
  }
  if (!hostname.endsWith("/")) {
    hostname = `${hostname}/`;
  }
  return { host, port, hostname };
}

/**
 * @param {string} target
 * @param {string} type
 * @param {any} data
 */
async function sendInternalRequest(target = "manager", type = "", data = null) {
  const { hostname } = getManagerHost(target);
  const url = `${hostname}api/${type}`;
  let stage = "start";
  let status = 0;
  let body = "";
  try {
    stage = "network";
    const isPostOnlyType = ["shutdown", "terminate", "stop"].includes(type);
    const response = await fetch(url, {
      method: data || isPostOnlyType ? "POST" : "GET",
      body: data && typeof data === "object" ? JSON.stringify(data) : isPostOnlyType ? "{}" : undefined,
      headers:
        data && typeof data === "object"
          ? {
              "Content-Type": "application/json",
            }
          : {},
    });
    stage = "body";
    status = response.status;
    body = await response.text();
  } catch (err) {
    if (type === "shutdown" && stage === "network") {
      return {
        success: true,
        reason: "Server is not executing (no connection)",
        hostname,
      };
    }
    if (status === 0 && body === "") {
      return {
        error: "Internal server request failed",
        stage,
        hostname,
      };
    }
    return {
      error: "Internal server request failed",
      stage,
      status,
      body,
      hostname,
    };
  }
  stage = "data";
  let obj;
  try {
    obj = body ? JSON.parse(body) : "";
  } catch (err) {
    return {
      error: "Internal server response interpretation failed",
      stage,
      status,
      body,
      hostname,
    };
  }
  stage = "response";
  if (obj && typeof obj === "object" && status !== 200) {
    obj.status = status;
  }
  return obj;
}
// ./src/logs/getCurrentStackList.js
function getCurrentStackList() {
  const text = new Error("a").stack.replace(/\\/g, "/").replace(/\r\n/g, "\n");
  const start = `at ${getCurrentStackList.name} (`;
  return text
    .substring(text.indexOf("\n", text.indexOf(start) + 1) + 1)
    .split("\n")
    .map((line) =>
      line.includes(".js") || line.includes(".cjs")
        ? line.replace(/\)/g, "").trim()
        : ""
    )
    .filter((a) => a.length && !a.includes(getCurrentStackList.name))
    .map((line) => line.substring(line.indexOf("at ") + 3).split("("))
    .map((parts) => ({
      source: parts[parts.length - 1],
      method: parts.length === 2 ? parts[0].trim() : "",
    }));
}
// ./src/utils/createInternalServer.js
/**
 * @param {string} host
 * @param {string | number} port
 * @param {(url: string, method: string, obj: any) => Promise<any>} handler
 * @returns {Promise<{url: string, server: http.Server}>}
 */
async function createInternalServer(host, port, handler) {
  const url = `http://${host}:${port}/`;
  const server = await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.on("request", (req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const q = req.url.indexOf("?");
      const url = req.url.substring(0, q === -1 ? req.url.length : q);
      const chunks = [];
      req.on("data", (data) => chunks.push(data));
      req.on("end", async () => {
        try {
          let text = "";
          if (chunks.length && chunks[0]?.length) {
            text = Buffer.concat(chunks).toString("utf-8");
          }
          if (text && (!text.startsWith("{") || !text.includes("}"))) {
            throw new Error(`Invalid request body with ${text.length} bytes`);
          }
          const obj = text ? JSON.parse(text) : null;
          if (q !== -1) {
            const urlArgPairs = req.url
              .substring(q + 1)
              .split("&")
              .map((a) => a.split("="))
              .filter((p) => p[0] && p[1] && !obj[p[0]]);
            for (const [key, value] of urlArgPairs) {
              obj[key.toLowerCase()] = obj[key.toLowerCase()] || value;
            }
          }
          const data = await handler(url, req.method, obj);
          if (!data || typeof data !== "object") {
            throw new Error(`Request handler returned invalid data: ${JSON.stringify(data)}`);
          }
          res.statusCode = data.status || (data.error ? 500 : 200);
          res.end(JSON.stringify(data, null, "  "));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message, stack: err.stack }, null, "  "));
        }
      });
    });
    server.listen(parseInt(port.toString()), host.toString(), () => resolve(server));
  });
  return {
    url,
    server,
  };
}
// ./src/process/executeProcessPredictably.js
/**
 * @typedef {{
 *   timeout?: number | undefined,
 *   throws?: boolean | Function | undefined,
 *   output?: ((t: string) => void) | false | 'ignore' | true | 'accumulate' | 'inherit' | 'pipe' | 'buffer' | 'raw' | 'binary',
 *   detached?: boolean | undefined,
 *   shell?: boolean | undefined,
 *   debug?: boolean | undefined,
 * }} PredictableExecutionConfig
 */

/**
 * @param {string | string[]} cmd
 * @param {string} [cwd]
 * @param {PredictableExecutionConfig} [config]
 * @returns {Promise<{start?: Date, duration?: number, output?: string | Buffer, error?: Error, exit?: number}>}
 */
async function executeProcessPredictably(cmd, cwd = ".", config = {}) {
  const timeout =
    typeof config.timeout !== "number" || config.timeout <= 0
      ? 0
      : config.timeout * (config.timeout > 0 && config.timeout < 99 ? 1000 : 1);

  const throws = config.throws;

  const attached = config.detached ? false : true;

  const outputType =
    attached && config.output === "inherit"
      ? "inherit"
      : config.output === false || config.output === "ignore" || !attached
      ? "ignore"
      : config.output === true || config.output === "accumulate"
      ? "buffer"
      : config.output instanceof Function
      ? "function"
      : config.output === "buffer" || config.output === "raw" || config.output === "binary"
      ? "binary"
      : config.output === "pipe" || config.output === "inherit"
      ? "pipe"
      : config.output;

  const shell = (config.shell === undefined && cmd instanceof Array) || config.shell === true;

  const debug = config.debug;
  const isArray = cmd instanceof Array;

  debug &&
    console.log(
      "Starting predictable process execution of",
      JSON.stringify(isArray ? cmd[0] : cmd.split(" ").shift()),
      "with args",
      { timeout, output: outputType, attached, shell },
      throws ? "(throw mode)" : ""
    );

  /**
   * @type {Awaited<ReturnType<typeof executeProcessPredictably>>}
   */
  const response = {};
  /** @type {any} */
  const spawnConfig = {
    cwd: path.resolve(!cwd || cwd === "." ? process.cwd() : cwd),
    stdio: ["ignore", "pipe", "pipe"],
    shell,
  };
  if (!attached) {
    spawnConfig.detached = true;
  }
  if (!attached || outputType === "ignore") {
    spawnConfig.stdio = ["ignore", "ignore", "ignore"];
  } else if (attached && config.output === "inherit") {
    spawnConfig.stdio = ["inherit", "inherit", "inherit"];
  } else if (["function", "pipe", "buffer"].includes(outputType)) {
    spawnConfig.stdio = ["ignore", "pipe", "pipe"];
  }
  try {
    await fs.promises.stat(spawnConfig.cwd);
  } catch (err) {
    debug && console.log("Failed to stat the target working directory:", err);
    response.error = new Error(`Working directory does not exist at "${cwd}"`);
    if (config.throws) {
      throw response.error;
    }
    return response;
  }
  debug && console.log("Process cmd:", cmd);
  debug && console.log("Process cwd:", cwd);
  const chunks = [];
  const type = await new Promise(function spawnExecuteProcessPredictably(resolve) {
    let timer = null;
    try {
      debug &&
        console.log(
          "Spawning",
          JSON.stringify(isArray ? cmd[0] : cmd.split(" ").shift()),
          timeout ? "with timeout" : "without timeout",
          isArray ? "with array argument" : "with string argument"
        );
      const child = isArray
        ? child_process.spawn(cmd[0], cmd.slice(1), spawnConfig)
        : child_process.spawn(cmd, spawnConfig);

      const onTimeout = () => {
        debug &&
          console.log("Timeout elapsed on", response.start ? "spawned" : "unspawned", "child (after", timeout, "ms)");
        timer = null;
        response.error = new Error(`Child timeout (${response.start ? "after spawn" : "not spawned"})`);
        resolve("timeout");
      };

      if (!attached) {
        child.unref();
        resolve("unref");
        return;
      }

      if (timeout && timeout > 0) {
        timer = setTimeout(onTimeout, timeout);
      }

      child.on("error", (err) => {
        debug && console.log("Error event during child spawn:", err);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (!response.error) {
          response.error = err;
        }
        if (response.start) {
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        resolve(response);
        return;
      });

      child.on("spawn", () => {
        response.start = new Date();
        debug && console.log("Child", child.pid, "spawned at", response.start.toISOString());
      });

      child.on("error", (err) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (!response.error) {
          response.error = err;
        }
        if (response.start) {
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        debug && console.log("Child finished:", response);
        resolve("error");
        return;
      });

      child.on("exit", (code) => {
        debug && console.log("Child exit:", code);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (response.start) {
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        response.exit = code;
        if (!response.error && code !== 0) {
          response.error = new Error(`Program exited with code ${code}`);
        }
        resolve(code);
      });

      const handleOutput =
        outputType === "function" || outputType === "pipe"
          ? config.output instanceof Function
            ? config.output
            : (t) => process.stdout.write(t)
          : null;

      if (child.stdout && child.stdout.on) {
        child.stdout.on("data", (data) =>
          handleOutput ? handleOutput(outputType === "binary" ? data : data.toString("utf-8")) : chunks.push(data)
        );
      }
      if (child.stderr && child.stderr.on) {
        child.stderr.on("data", (data) =>
          handleOutput ? handleOutput(outputType === "binary" ? data : data.toString("utf-8")) : chunks.push(data)
        );
      }
    } catch (err) {
      debug && console.log("Exception during spawn:", err);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!response.error) {
        response.error = err;
      }
      resolve(response);
    }
  });
  debug && console.log("Process finished type:", type);
  debug && console.log("Process handling response:", response);
  if (chunks.length) {
    response.output = outputType === "binary" ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf-8");
  }
  if (response.error && config.throws) {
    throw response.error;
  }
  return response;
}
// ./src/utils/recursivelyIterateDirectoryFiles.js
/**
 * @param {string} target
 * @param {(name: string, path: string, stat: fs.Stats, depth: number) => boolean} selectFunc
 * @param {string[]} array
 * @param {number} [depth]
 * @returns
 */
async function recursivelyIterateDirectoryFiles(target, selectFunc = () => true, array = [], depth = 0) {
  if (depth > 20) {
    return array;
  }
  try {
    const stat = await fs.promises.stat(target);
    // Skip filtered
    if (!selectFunc(path.basename(target), target, stat, depth)) {
      return array;
    }
    if (stat.isFile()) {
      if ((target !== "/" && target.endsWith("/")) || target.endsWith("\\")) {
        throw new Error("Invalid folder path for file");
      }
      array.push(target);
      return array;
    }
    const files = await fs.promises.readdir(target);
    for (const file of files) {
      const next = `${
        (target !== "/" && target.endsWith("/")) || target.endsWith("\\")
          ? target.substring(0, target.length - 1)
          : target
      }/${file}`;

      if (array.find((a) => path.resolve(a) === path.resolve(next))) {
        // Skip duplicates
        continue;
      }

      array.push(next);

      await recursivelyIterateDirectoryFiles(next, selectFunc, array, depth + 1);
    }
  } catch (err) {
    //console.log(err);
  }
  return array;
}
// ./src/modes/helpMode.js
global.modeDescRec = {
  "--help / -h": "Display this help text",
  "--setup": "Initialize and setup a project for automatic deployment",
  "--config": "Change settings and configure a repository interactively",
  "--status / -s": "Retrieve status information from the manager process",
  "--logs / -l": "Print and stream logs continuously",
  "--instance / --app": "Print and stream logs from the project instance process",
  "--start / --restart": "Start or restart the manager process and display its status",
  "--shutdown": "Stop the project process and the instance manager process",
  "--upgrade <path>": "Fetch the deployment script source and write to a target file",
  "--schedule": "Manually schedule the asyncronous execution of the deployment pipeline",
  "--schedule <commit>": "Schedules deployment of a specific version of the project",
  "--schedule <ref>": "Schedules deployment specifying the project version by a reference",
  "--process": "Execute the deployment syncronously at the current project version",
  "--process <commit>": "Execute the deployment at a specific commit",
  "--process <rev>": "Execute a deployment pipeline at a specific branch reference",
  "--manager": "Run this program to manage the project instance synchronously",
};
global.modeDescs = Object.entries(modeDescRec)
global.flagDescs = [
  ["--debug / --verbose / -d", "Enable verbose mode (prints more logs)"],
  ["--force / --yes / -y", "Force confirmations, automatically assuming yes "],
  ["--dry-run / --dry", "Simulate execution by not writing files and causing no side-effects"],
  ["--sync / --wait", "Execute child processes syncronously"],
];
global.pad = Math.max(...[...modeDescs, ...flagDescs].map((a) => a[0].length)) + 2

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initHelp(options) {
  console.log("Node Deployment Manager Program");
  console.log("");
  const debug = options.debug;
  if (debug) {
    console.log("Program arguments:", process.argv.slice(2));
    console.log("Program working directory:", process.cwd());
    console.log("");
  } else {
    await sleep(500);
    console.log("");
  }
  console.log("\tContinuous Deployment Manager for projects in git repositores.");
  const name = path.basename(process.argv[1]);

  console.log("");
  console.log("  Usage:");
  console.log("");
  if (options.debug) {
    console.log(`\t${name} <mode> [...options]`);
  } else {
    console.log(`\t${name} [repo-path]            Initialize and configure a project for automatic deployment.`);
  }
  console.log("");
  console.log(" Flags:");
  console.log("");
  for (const k of flagDescs) {
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  console.log("");
  console.log(" Modes:");
  const limit = options.debug ? modeDescs.length : 9;
  for (let i = 0; i < limit; i++) {
    const k = modeDescs[i];
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  if (!options.debug) {
    console.log(' (for advanced usage include the "--verbose" argument)');
  }
  console.log("");
  console.log("For more information visit this project's repository:");
  console.log("");
  console.log("\thttps://github.com/GuilhermeRossato/node-deployment");
  console.log("");
}
// ./src/logs/outputDatedLine.js
global.lastDatePrinted = ""
function outputDatedLine(prefix, date, ...args) {
  let dateStr = "";

  if (typeof date === "string" && !date.startsWith("2") && !date.startsWith("1")) {
    dateStr = date;
    if (dateStr.length > 20) {
      dateStr = dateStr.substring(0, 20);
    }
    if (dateStr.length < 17) {
      dateStr = `| ${dateStr} |`;
    } else if (dateStr.length < 19) {
      dateStr = `|${dateStr}|`;
    }
    while (dateStr.length < 19) {
      dateStr = ` ${dateStr} `;
    }
  } else {
    dateStr = date ? getDateTimeString(date).substring(0, 19) : "";
    const [yyyymmdd, hhmmss] = dateStr.split(" ");
    if (yyyymmdd && hhmmss && lastDatePrinted.startsWith(yyyymmdd)) {
      dateStr = hhmmss;
      lastDatePrinted = lastDatePrinted.substring(0, lastDatePrinted.length - 1);
    } else {
      lastDatePrinted = dateStr;
    }
  }
  if (dateStr.length !== 20) {
    dateStr = dateStr.substring(0, 20).padStart(20, " ");
  }
  const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  process.stdout.write(`${prefix + dateStr} ${text}\n`);
}

function outputLogEntry(prefix, obj) {
  if (obj.pid && process.stdout && process.stdout.columns >= 60) {
    const right = `PID: ${obj.pid.toString()}`;
    const s = process.stdout.columns - right.length - 2;
    process.stdout.write(`${" ".repeat(s) + right}\r`);
  }
  if (!obj.src && !obj.pid) {
    outputDatedLine(` [${prefix}]`, obj.time, obj.text);
  } else {
    outputDatedLine(` [${prefix}]`, obj.time, ` ${obj.src}`, "-", obj.pid.toString(), "-", obj.text);
  }
  return obj.time;
}
// ./src/process/killProcessByPid.js
/**
 * @param {string | number} processId 
 * @param {'kill' | 'force' | 'sigint' | 'sigterm'} [type]
 */
async function killProcessByPid(processId, type = 'force') {
  const pid = parseInt(processId.toString());
  if (isNaN(pid) || pid <= 1) {
    return null;
  }
  let result;
  if (type === 'kill' || type === 'force') {
    return await executeProcessPredictably(
      type === 'force' ? `kill -9 ${pid}` : `kill ${pid}`,
      process.cwd(),
      {timeout: 5_000}
    );
  } else {
    try {
      result = process.kill(pid, type === 'sigint' ? 'SIGINT' : 'SIGTERM');
    } catch (err) {
      result = err;
    }
  }
  return result;
}
// ./src/lib/executeWrappedSideEffect.js
global.canExecSideEffect = null

function canExecuteSideEffects() {
  if (canExecSideEffect === null) {
    const { options } = getParsedProgramArgs();
    canExecSideEffect = options.dry ? false : true;
  }
  return canExecSideEffect;
}

async function executeWrappedSideEffect(description, func, ...args) {
  if (!canExecuteSideEffects()) {
    console.log(`Skipping side effect (dry-run enabled): ${description}`);
    return false;
  }
  return await func(...args);
}
// ./src/process/isProcessRunningByPid.js
async function isProcessRunningByPid(pid) {
  pid = parseInt(pid.toString().trim());
  let y = 0;
  let n = 0;
  for (let i = 0; i < 8; i++) {
    try {
      process.kill(pid, 0);
      y++;
    } catch (err) {
      n++;
    }
    await sleep(50);
  }
  return y - 1 > n;
}
// ./src/lib/fetchProjectReleaseFileSource.js
async function fetchProjectReleaseFileSource() {
  const authorName = "GuilhermeRossato";
  const projectName = "node-deployment";
  const fileName = "node-deploy.cjs";
  const res = await fetchProjectReleaseFileSourceRaw(authorName, projectName, fileName);
  if (!res||!res.release||!res.buffer) {
    throw new Error('Failed to fetch project release source file');
  }
  const prefix = Buffer.from(
    [
      `// Node Deployment Manager ${res.release} - https://github.com/${authorName}/${projectName}`,
      `// File "${res.name}" downloaded at ${new Date().toISOString()} from ${res.url}`,
      `// Release created at ${getDateTimeString(res.created)} and updated at ${getDateTimeString(res.updated)}\n\n`,
    ].join("\n")
  );
  res.buffer = Buffer.concat([prefix, res.buffer]);
  return res;
}

/**
 * Fetch the release source file code from the repository url using Github API
 */
async function fetchProjectReleaseFileSourceRaw(
  authorName = "GuilhermeRossato",
  projectName = "node-deployment",
  fileName = "node-deploy.cjs"
) {
  const api = `https://api.github.com/repos/${authorName}/${projectName}`;
  const res = await fetch(`${api}/releases`, {
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const list = await res.json();
  if (list instanceof Array && list.length) {
    for (let i = 0; i < list.length; i++) {
      for (const asset of list[i].assets) {
        if (asset.name === fileName) {
          const url = asset.browser_download_url;
          const r = await fetch(url, {
            headers: {
              "X-GitHub-Api-Version": "2022-11-28",
              Accept: "*/*",
            },
          });
          const blob = await r.blob();
          const array = await blob.arrayBuffer();
          return {
            name: asset.name,
            buffer: Buffer.from(array),
            release: list[i].tag_name,
            size: asset.size,
            created: new Date(asset.created_at),
            updated: new Date(asset.updated_at),
            url,
          };
        }
      }
    }
  }
}
// ./src/logs/attachToConsole.js
global.addSource = true
global.addPid = true
global.addDate = true
global.addHour = true
global.addPrefix = []

/**
 *
 * @param {boolean} [source]
 * @param {boolean} [pid]
 * @param {boolean} [date]
 * @param {boolean} [hour]
 * @param {string | any[]} [prefix]
 */
function configLog(source, pid, date, hour, prefix) {
  addSource = source === undefined ? addSource : source;
  addPid = pid === undefined ? addPid : pid;
  addDate = date === undefined ? addDate : date;
  addHour = hour === undefined ? addHour : hour;
  addPrefix =
    prefix === undefined ? addPrefix : typeof prefix === "string" ? [prefix] : prefix instanceof Array ? prefix : [];
}

/**
 * @param {string} method
 * @param {string | undefined | null} [logFilePath]
 * @returns
 */
function attachToConsole(method = "log", logFilePath = "", hidePrefix = false) {
  const originalMethod = console[method].bind(console);
  let inside = false;
  const handleCall = (...args) => {
    if (inside) {
      return originalMethod(...args);
    }
    inside = true;
    let pcount = 0;
    try {
      if (addPid) {
        pcount++;
        args.unshift(`${process.pid} -`);
      }
      if (addSource) {
        let stackFileList = new Error("a").stack
          .split("\n")
          .map((a) =>
            a
              .substring(Math.max(a.lastIndexOf("\\"), a.lastIndexOf("/")) + 1, a.lastIndexOf(":"))
              .replace(")", "")
              .trim()
          )
          .filter((a) => (a.includes(".js:") || a.includes(".cjs:")) && !a.includes(attachToConsole.name));
        let src = stackFileList.slice(0, 1).reverse().join(" -> ");

        if (src.startsWith("node-deploy.cjs:")) {
          const list = getCurrentStackList().filter(
            (a) => !a.source.includes(attachToConsole.name) && !a.source.includes(getCurrentStackList.name) && !a.method.includes(handleCall.name)
          );
          src = list
            .map((p) => p.method)
            .slice(0, 1)
            .reverse()
            .join(" -> ");
        }
        if (!src) {
          src = "?";
        }
        pcount++;
        args.unshift(`${addDate || addHour ? "- " : ""}${src} -`);
      }

      const [date, hour] = getDateTimeString().substring(0, 23).split(" ");
      if (addHour) {
        pcount++;
        args.unshift(hour);
      }
      if (addDate) {
        pcount++;
        args.unshift(date);
      }
      if (addPrefix && addPrefix.length) {
        pcount++;
        args.unshift(...addPrefix.map((e) => (e instanceof Function ? e() : e)));
      }
      if (logFilePath) {
        let text;
        try {
          text = args
            .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack : JSON.stringify(a)))
            .join(" ");
        } catch (err) {
          text = args
            .map((a) => {
              try {
                typeof a === "string" ? a : a instanceof Error ? a.stack : JSON.stringify(a);
              } catch (err) {
                return "(failed to stringify)";
              }
            })
            .join(" ");
        }
        try {
          fs.appendFileSync(logFilePath, `${text}\n`, "utf-8");
        } catch (err) {
          // Ignore
        }
      }
      if (false || (hidePrefix && pcount)) {
        args = args.slice(pcount);
      }
      originalMethod(...args);
      inside = false;
    } catch (err) {
      originalMethod(`\n\nLogging failed:\n${err.stack}\n\n`);
      inside = false;
    }
  };

  console[method] = handleCall;

  return originalMethod;
}
// ./src/lib/getInstancePathStatuses.js
async function getInstancePathStatuses(options = undefined) {
  if (!options) {
    options = getParsedProgramArgs(false).options;
  }
  let deploymentPath;
  try {
    deploymentPath = path.resolve(options.dir || process.cwd(), process.env.DEPLOYMENT_FOLDER_NAME || "deployment");
  } catch (err) {
    throw new Error(`Could not resolve deploy folder path: ${err.message}`);
  }
  try {
    const oldInstancePath = process.env.OLD_INSTANCE_FOLDER_PATH
      ? path.resolve(deploymentPath, process.env.OLD_INSTANCE_FOLDER_PATH)
      : "";
    const prevInstancePath = path.resolve(deploymentPath, process.env.PREV_INSTANCE_FOLDER_PATH || "previous-instance");
    const nextInstancePath = path.resolve(deploymentPath, process.env.NEXT_INSTANCE_FOLDER_PATH || "upcoming-instance");
    const currInstancePath = path.resolve(
      deploymentPath,
      process.env.CURR_INSTANCE_FOLDER_PATH || process.env.INSTANCE_FOLDER_PATH || "current-instance"
    );
    const deploy = await checkPathStatus(deploymentPath);
    const old = oldInstancePath ? await checkPathStatus(oldInstancePath) : null;
    const prev = prevInstancePath ? await checkPathStatus(prevInstancePath) : null;
    const next = nextInstancePath ? await checkPathStatus(nextInstancePath) : null;
    const curr = currInstancePath ? await checkPathStatus(currInstancePath) : null;
    return {
      deploy,
      old,
      prev,
      next,
      curr,
    };
  } catch (err) {
    throw new Error(`Could not resolve instance paths: ${err.message}`);
  }
}
// ./src/logs/readLogFile.js
async function getLogFileStatus(root, mode) {
  let deploy = await checkPathStatus([
    root,
    process.env.DEPLOYMENT_FOLDER_NAME || process.env.LOG_FOLDER_NAME || "deployment",
  ]);
  if (!deploy.type.dir) {
    deploy = await checkPathStatus([
      root,
      ".git",
      process.env.DEPLOYMENT_FOLDER_NAME || process.env.LOG_FOLDER_NAME || "deployment",
    ]);
  }
  if (!deploy.type.dir) {
    throw new Error(`Deployment folder not found at ${JSON.stringify(deploy.path)}`);
  }
  if (mode.includes(".") || mode.includes("/")) {
    mode = mode.substring(mode.lastIndexOf("/") + 1, mode.lastIndexOf("."));
  }
  const name = `${mode}.log`;
  return await checkPathStatus([deploy.path, name]);
}

global.extra = getDateTimeString(new Date(), true).substring(24)

function separateLogLineDate(line) {
  if (!line.trim().length || !line.startsWith("2")) {
    return null;
  }
  const dateTimeSep = line.indexOf(" ");
  const dateSrcSep = line.indexOf(" - ", dateTimeSep);
  if (dateTimeSep !== 10 || dateSrcSep === -1) {
    return null;
  }
  const dateStr = line.substring(0, dateTimeSep);
  const timeStr = line.substring(dateTimeSep + 1, dateSrcSep);
  const time = new Date(`${dateStr} ${timeStr} ${extra}`).getTime();
  const srcPidStep = line.indexOf(" - ", dateSrcSep + 3);
  if (srcPidStep === -1) {
    return { time, src: "", pid: 0, text: line.substring(dateSrcSep + 3) };
  }
  const pidTxtStep = line.indexOf(" - ", srcPidStep + 3);
  const srcStr = line.substring(dateSrcSep + 3, srcPidStep);
  const pidStr = line.substring(srcPidStep + 3, pidTxtStep);
  if (srcPidStep === -1 || !pidStr.length || /\D/g.test(pidStr)) {
    return { time, src: "", pid: 0, text: line.substring(dateSrcSep + 3) };
  }
  if (pidTxtStep === -1) {
    return { time, src: "", pid: parseInt(pidStr), text: line.substring(srcPidStep + 3) };
  }
  return { time, src: srcStr, pid: parseInt(pidStr), text: line.substring(pidTxtStep + 3) };
}

/**
 * @param {string} filePath
 * @param {number} [offset]
 * @param {Buffer} [buffer]
 */
async function readLogFile(filePath, offset, buffer) {
  const result = {
    size: 0,
    read: 0,
    list: [].map(separateLogLineDate),
    buffer,
    offset,
    sizeDesc: "",
    updateTime: 0,
    text: "",
  };
  const stat = await asyncTryCatchNull(fs.promises.stat(filePath));
  if (!stat || stat instanceof Error || stat.size === 0 || !stat.isFile()) {
    return result;
  }
  const size = (result.size = stat.size);
  result.updateTime = stat.mtimeMs;
  const elapsed = new Date().getTime() - stat.mtimeMs;

  result.sizeDesc = isNaN(elapsed)
    ? "(no file)"
    : size === 0
    ? "(empty)"
    : size < 1024
    ? `${size} bytes`
    : size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`;

  if (offset && offset >= stat.size) {
    result.offset = stat.size;
    return result;
  }
  const f = await asyncTryCatchNull(fs.promises.open(filePath, "r"));
  if (!f || f instanceof Error) {
    return result;
  }
  try {
    if (!result.buffer && !buffer) {
      buffer = Buffer.alloc(16384);
      result.buffer = buffer;
    }
    if (typeof offset === "number" && offset < 0) {
      offset = Math.max(0, result.size + offset);
    }
    if (
      buffer.byteLength &&
      (offset === undefined || offset === null || typeof offset !== "number" || offset < 0 || isNaN(offset))
    ) {
      offset = Math.max(0, stat.size - buffer.byteLength);
    }
    const readResult = await f.read({ position: offset, buffer });
    result.read = readResult.bytesRead;
  } catch (err) {
    await f.close();
    console.log("Failed reading logs:");
    console.log(err);
    return result;
  }
  await f.close();
  try {
    result.text = buffer.slice(0, result.read).toString("utf-8").trim().replace(/\r/g, "");
    const nl = result.text.indexOf("\n");
    if (nl !== -1 && nl < 20) {
      result.text = result.text.substring(result.text.indexOf("\n") + 1);
    }
    result.list = result.text.split("\n").map(separateLogLineDate).filter(Boolean);
  } catch (err) {
    console.debug(err);
  }
  result.offset = offset;
  return result;
}
// ./src/modes/upgradeMode.js
/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initUpgrade(options) {
  const release = await fetchProjectReleaseFileSource();
  console.log("Loaded", JSON.stringify(release.name), "from", JSON.stringify(release.release), "updated at", getDateTimeString(release.updated));
  const buffer = release.buffer;
  let info = await checkPathStatus(path.resolve(process.cwd(), options.dir || process.argv[1]));
  if (info.type.file) {
    const stat = await fs.promises.stat(info.path);
    if (
      !options.force &&
      info.name !== "node-deploy.cjs" &&
      stat.size !== 0 &&
      (stat.size < 40000 || stat.size > 120000)
    ) {
      throw new Error(
        `Specified file path does not look like a source file at ${info.path} (can be ignored with "--force")`
      );
    }
    return await performUpgrade(info.path, buffer);
  }
  if (info.type.dir) {
    let list = info.children.filter((f) => f.endsWith(".cjs"));
    if (!list.length) {
      list = info.children.filter((f) => f.endsWith(".js"));
    }
    if (!list.length) {
      list = info.children;
    }
    let target = "node-deploy.cjs";
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    target = "node-deploy.js";
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    target = path.basename(process.argv[1]);
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    const objs = await Promise.all(
      list.map(async (n) => ({
        file: path.resolve(info.path, n),
        stat: await fs.promises.stat(path.resolve(info.path, n)),
      }))
    );
    target = objs
      .sort((a, b) => a.stat.size - b.stat.size)
      .map((p) => p.file)
      .pop();
    if (!target) {
      target = "node-deploy.cjs";
    }
    return await performUpgrade(target, buffer);
  }
  throw new Error("Could not find a script file to upgrade");
}

async function performUpgrade(target, buffer) {
  if (!buffer || !(buffer instanceof Buffer)) {
    throw new Error("Invalid upgrade data");
  }
  console.log("Writing", buffer.byteLength, "bytes", "to", target);
  await fs.promises.writeFile(target, buffer);
}
// ./src/process/executeGitProcessPredictably.js
async function executeGitProcessPredictably(cmd, repoPath = "") {
  if (!repoPath) {
    const { options } = getParsedProgramArgs(false);
    const root = options.dir || process.cwd();
    repoPath = path.resolve(root);
  }
  let status = await checkPathStatus(repoPath);
  // inside deployment folder
  if (
    status.type.dir &&
    (status.children.includes("node-deploy.cjs") ||
      status.name === process.env.DEPLOYMENT_FOLDER_NAME ||
      status.children.includes(".env")) &&
    !status.children.includes("refs") &&
    !status.children.includes("config") &&
    !status.children.includes("hooks")
  ) {
    const par = await checkPathStatus(path.dirname(status.path));
    if (
      !(
        par.type.dir &&
        (par.children.includes("node-deploy.cjs") ||
          par.name === process.env.DEPLOYMENT_FOLDER_NAME ||
          par.children.includes(".env")) &&
        !par.children.includes("refs") &&
        !par.children.includes("config") &&
        !par.children.includes("hooks")
      )
    ) {
      // console.log(`Raising from repository "${status.name}" to parent "${path.basename(status.parent)}"`);
      status = par;
    }
  }
  if (!status.type.dir) {
    throw new Error(`Could not find a repository folder path at "${status.path}"`);
  }
  const config = await checkPathStatus(
    status.children.includes("config") ? [status.path, "config"] : [status.path, ".git", "config"]
  );
  // inside .git folder
  if (
    status.type.dir &&
    status.name === ".git" &&
    status.children.includes("hooks") &&
    status.children.includes("refs") &&
    status.children.includes("config")
  ) {
    const parent = await checkPathStatus(status.parent);
    if (parent.type.dir && parent.children.includes(".git")) {
      // console.log(`Raising from repository "${status.name}" to parent "${path.basename(status.parent)}"`);
      status = parent;
    }
  }
  if (!status.type.dir) {
    throw new Error(`Could not find a repository folder path at "${status.path}"`);
  }
  let bare = false;
  if (config.type.file) {
    try {
      const text = await fs.promises.readFile(path.resolve(config.path), "utf-8");
      bare = text.replace(/\s/g, "").includes("bare=true");
    } catch (err) {
      console.log(
        `Warning: Failed while reading git config file for repository "${path.basename(status.path)}" at "${
          config.path
        }"`
      );
      bare = false;
    }
  }
  if (bare && status.name === ".git" && status.type.dir && status.children.includes("config")) {
    repoPath = path.dirname(status.path);
  } else {
    repoPath = status.path;
  }
  // console.log("Executing git command at", JSON.stringify(repoPath));
  const result = await executeProcessPredictably(cmd.trim(), repoPath, {
    timeout: 10_0000,
    throws: true,
    shell: true,
  });
  if (result.exit !== 0) {
    throw new Error(`Unexpected git exit (code ${result.exit}): ${JSON.stringify(result)}`);
  }
  if (typeof result.output !== "string" && !result.output) {
    result.output = "";
  }
  if (typeof result.output !== "string") {
    throw new Error(`Unexpected git output (exit code ${result.exit}): ${JSON.stringify(result)}`);
  }
  return result;
}
// ./src/lib/getRepoCommitData.js
async function getRepoCommitData(repositoryPath, ref) {
  const result = await asyncTryCatchNull(getRepoCommitDataUnsafe(repositoryPath, ref));
  if (!result || result instanceof Error) {
    return {
      error: result instanceof Error ? result : new Error("Could not get commit data"),
      path: "",
      hash: "",
      date: new Date(),
      message: "",
    };
  }
  return result;
}
async function executeGitCheckout(repositoryPath, targetPath, ref = "") {
  const cmd = `git --work-tree="${repositoryPath}" checkout -f${ref ? ` ${ref}` : ""}`;
  if (!fs.existsSync(targetPath)) {
    console.log("Creating target directory at", JSON.stringify(targetPath));
    await fs.promises.mkdir(targetPath, { recursive: true });
  }
  const result = await executeGitProcessPredictably(cmd, targetPath);
  return result;
}

async function getRepoCommitDataUnsafe(repositoryPath = "", ref = "") {
  const cmd = `git log --format="%H %cd %cn: %s" --date=iso -1 ${ref ? ` ${ref}` : ""}`;
  const result = await executeGitProcessPredictably(cmd, repositoryPath);
  const text = result.output.toString().trim();
  const [hash, date, hour, tz, ...rest] = text.replace(/\s\s+/g, " ").split(" ");
  return {
    path: repositoryPath,
    hash,
    date: new Date(date + " " + hour + " " + tz),
    message: rest.join(" "),
  };
}

async function getHashFromRef(targetPath, ref) {
  let root = await checkPathStatus([targetPath]);
  if (!root.type.dir || !root.children.includes("refs")) {
    root = await checkPathStatus([targetPath, ".git"]);
  }
  if (!root.type.dir || !root.children.includes("refs")) {
    throw new Error(`Invalid info ${JSON.stringify(root)}`);
  }
  // Replace refs
  if (ref.startsWith("refs/")) {
    ref = ref.substring(ref.indexOf("/") + 1);
  }
  // Replace head
  if (ref.startsWith("heads/")) {
    ref = ref.substring(ref.indexOf("/") + 1);
  }
  const heads = await checkPathStatus([root.path, "refs", "heads"]);
  const index = heads.type.dir ? heads.children.indexOf(ref) : -1;
  if (index !== -1) {
    const hash = await fs.promises.readFile(path.resolve(heads.path, heads.children[index]), "utf-8");
    return hash.trim();
  }
  throw new Error(`Invalid ref`);
}
// ./src/logs/getLastLogs.js
/**
 * @param {string[]} prefixes File name prefix list to filter
 * @param {string[]} names
 * @param {Buffer[]} buffers
 * @param {number} size
 */
async function getLastLogs(prefixes = [], names = [], buffers = [], size = 4096) {
  const { options } = getParsedProgramArgs(false);
  let status = await checkPathStatus(options.dir || process.cwd());
  // inside deployment folder
  if (
    status.type.dir &&
    (status.children.includes("node-deploy.cjs") ||
      status.name === process.env.DEPLOYMENT_FOLDER_NAME ||
      status.children.includes(".env")) &&
    !status.children.includes("refs") &&
    !status.children.includes("config") &&
    !status.children.includes("hooks")
  ) {
    const par = await checkPathStatus(path.dirname(status.path));
    if (
      !(
        par.type.dir &&
        (par.children.includes("node-deploy.cjs") ||
          par.name === process.env.DEPLOYMENT_FOLDER_NAME ||
          par.children.includes(".env")) &&
        !par.children.includes("refs") &&
        !par.children.includes("config") &&
        !par.children.includes("hooks")
      )
    ) {
      status = par;
    }
  }
  // outside .git folder
  if (
    status.type.dir &&
    status.children.includes(".git") &&
    (!status.children.includes("hooks") || !status.children.includes("refs") || !status.children.includes("config"))
  ) {
    const inside = await checkPathStatus([status.path, ".git"]);
    if (
      inside.type.dir &&
      inside.children.includes(process.env.DEPLOYMENT_FOLDER_NAME) &&
      inside.children.includes("refs") &&
      inside.children.includes("config")
    ) {
      status = inside;
    }
  }
  return await getProjectRepoLogs(status.path, prefixes, names, buffers, size);
}

async function getProjectRepoLogs(projectPath, prefixes = [], names = [], buffers = [], size = 4096) {
  const root = `${path.resolve(projectPath)}/`;
  const unfiltered = await getProjectRepoLogsFiles(projectPath);

  const getBase = (str) =>
    [str.replace(/\\/g, "/")]
      .map((n) => n.substring(n.lastIndexOf("/") + 1, n.includes(".") ? n.lastIndexOf(".") : n.length))
      .join("");

  const bases = prefixes.map((n) => getBase(n));

  const fileList = unfiltered.filter((f) => {
    if (!bases.length) {
      return true;
    }
    const base = getBase(f.path);
    if (bases.some((p) => base.startsWith(p))) {
      return true;
    }
    return false;
  });

  const list = [];
  for (let i = 0; i < fileList.length; i++) {
    const logName = fileList[i].path.substring(root.length);
    if (!names.includes(logName)) {
      names.push(logName);
    }
    const result = await readLogFile(fileList[i].path, -size, buffers[i]);
    if (!buffers[i]) {
      buffers[i] = result.buffer;
    }
    const entries = result.list.map((o, i, a) => ({
      file: logName,
      time: a
        .slice(0, i + 1)
        .reverse()
        .map((a) => a.time)
        .find((a) => a && !isNaN(a)),
      src: o.src,
      pid: o.pid,
      text: o.text,
    }));
    for (const e of entries) {
      if (e.time && !isNaN(e.time)) {
        list.push(e);
      }
    }
  }
  return {
    list: list.sort((a, b) => a.time - b.time),
    buffers,
    names,
    prefixes,
    projectPath,
  };
}

/**
 * @param {string} target
 */
async function getProjectRepoLogsFiles(target) {
  const status = await checkPathStatus(target);
  if (!status.type.dir) {
    throw new Error(`Invalid target: ${status.path}`);
  }
  if (!status.children.includes(process.env.DEPLOY_FOLDER_NAME || "deployment")) {
    throw new Error(`Invalid unitialized target: ${status.path}`);
  }
  const deploy = await checkPathStatus([status.path, process.env.DEPLOY_FOLDER_NAME || "deployment"]);
  if (!deploy.type.dir || !deploy.children.includes("node-deploy.cjs")) {
    throw new Error(`Invalid target deploy folder: ${deploy.path}`);
  }
  const everything = await recursivelyIterateDirectoryFiles(deploy.path, (name, _path, stat, depth) => {
    if (depth >= 3) {
      return false;
    }
    if (stat.isFile() && name.endsWith(".log")) {
      return true;
    }
    if (stat.isDirectory() && name !== "node_modules") {
      return true;
    }
    return false;
  });
  const statusList = await Promise.all(everything.map((f) => checkPathStatus(f)));
  const fileList = [];
  for (const s of statusList) {
    if (fileList.find((f) => f.path === s.path)) {
      continue;
    }
    if (s.type.file && s.name.endsWith(".log")) {
      fileList.push(s);
    }
  }
  return fileList;
}
// ./src/logs/waitForLogFileUpdate.js
global.debugWaitForLog = false

async function waitForLogFileUpdate(cursor = 0, pids = [], modes = []) {
  for (let cycle = 0; true; cycle++) {
    await sleep(200);
    const next = await getLastLogs(modes);
    if (cycle === 0) {
      console.log(`Waiting for log updates (currently ${next.names.length} files matched modes)`);
      debugWaitForLog && console.log("Mode filters:", modes);
      debugWaitForLog && console.log("Previous pids:", pids);
      debugWaitForLog && console.log("Cursor:", cursor);
    }
    const list = next.list.filter((l) => l.time > cursor);
    if (list.length === 0) {
      await sleep(200);
      continue;
    }
    if (!pids || pids.length === 0 || cycle > 15) {
      console.log("Log file updated:\n");
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const prefix = obj.file;
      outputDatedLine(`[${prefix}]`, obj.time, obj.pid, obj.src, obj.text);
    }
    if (!pids || pids.length === 0 || cycle > 15) {
      return list;
    }
    const novelPids = [...new Set(list.map((a) => a.pid).filter((p) => !pids.includes(p)))];
    if (novelPids.length) {
      debugWaitForLog && console.log("New pid at logs:", novelPids);
      return list;
    }
    continue;
  }
}
// ./src/modes/logsMode.js
/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initLogs(options) {
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  const prefixes = options.mode === "runtime" ? ["instance"] : [];
  const logs = await getLastLogs(prefixes);
  if (logs.names.length === 0) {
    console.log("Could not find any log file");
  } else {
    process.stdout.write(`Loaded ${logs.names.length} log files from ${JSON.stringify(logs.projectPath)}`);
    process.stdout.write("\n");
    const header = "     log-file          yyyy-mm-dd hh:mm:ss        source - pid - text...      ";
    process.stdout.write(`${"-".repeat(header.length)}\n`);
    process.stdout.write(`${header}\n`);
    process.stdout.write(`${"-".repeat(header.length)}\n`);
    await sleep(200);
  }
  const list = logs.list;
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  let cursor = 0;
  let i = Math.max(0, list.length - 50);
  for (i = i; i < list.length; i++) {
    const obj = list[i];
    cursor = outputLogEntry(obj.file.substring(obj.file.length - 20).padStart(20), obj);
  }
  if (options.debug) {
    console.log("");
    if (prefixes.length) {
      console.log("Filters  :", JSON.stringify(prefixes));
    }
    console.log("Current  :", getDateTimeString(new Date().getTime()));
    if (list.length) {
      console.log(
        "Last file:",
        JSON.stringify(list[list.length - 1].file),
        "written by pid",
        list[list.length - 1].pid
      );
      console.log("");
    }
    console.log(
      "Last log :",
      getDateTimeString(cursor),
      `(updated ${getIntervalString(new Date().getTime() - cursor)} ago)`
    );

    await sleep(1000);
  }
  process.stdout.write("\n");
  await sleep(200);
  console.log(" Watching Logs:");
  await sleep(200);
  process.stdout.write("\n");
  await sleep(200);
  await streamStatusLogs(cursor, true, prefixes);
}

async function streamStatusLogs(cursor = 0, continuous = true, prefixes = []) {
  let lastPrint = new Date().getTime();
  for (let cycle = 0; true; cycle++) {
    await sleep(300);
    const all = await getLastLogs(prefixes);
    const list = all.list.filter((l) => l.time > cursor);
    if (list.length === 0) {
      await sleep(300);
      if (lastPrint && new Date().getTime() - lastPrint > 60_000) {
        process.stdout.write(`  (No updates since ${getDateTimeString(cursor)})\n`);
        lastPrint = 0;
      }
    } else {
      lastPrint = new Date().getTime();
    }
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (obj.file.endsWith("logs.log")) {
        continue;
      }
      cursor = outputLogEntry(obj.file.substring(obj.file.length - 16).padStart(16), obj);
      await sleep(15);
    }
    if (!continuous) {
      break;
    }
  }
}
// ./src/lib/readWritePidFile.js
async function getPidFileStatus(root, mode) {
  let deploy = await checkPathStatus([root, process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
  if (!deploy.type.dir) {
    deploy = await checkPathStatus([root, ".git", process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
  }
  if (!deploy.type.dir) {
    throw new Error(`Deployment folder not found at ${JSON.stringify(deploy.path)}`);
  }
  if (!mode) {
    throw new Error(`Invalid pid file mode: ${mode}`);
  }
  if (mode.includes(".") || mode.includes("/")) {
    mode = mode.substring(mode.lastIndexOf("/") + 1, mode.lastIndexOf("."));
  }
  const name = `${mode}.pid`;
  return await checkPathStatus([deploy.path, name]);
}

async function writePidFile(mode, pid = null) {
  const { options } = getParsedProgramArgs(false);
  const root = options.dir || process.cwd();
  const status = await getPidFileStatus(root, mode);
  if (status.type.file) {
    options.debug &&
      console.log(
        "Overwriting",
        JSON.stringify(status.name),
        `(updated ${getIntervalString(new Date().getTime() - status.mtime)} ago)`
      );
  }
  pid = (pid || process.pid).toString();
  await executeWrappedSideEffect(
    `${status.type.file ? "Updating" : "Creating"} pid at "./${path.basename(status.parent)}/${status.name}"`,
    async () => {
      await fs.promises.writeFile(status.path, pid);
      options.debug && console.log(status.type.file ? "Updated" : "Created", mode, "pid file at:", status.path);
    }
  );
  return {
    time: new Date().getTime(),
    pid,
    path: status.path,
    read: () => readPidFile(mode),
  };
}

async function readPidFile(mode) {
  const { options } = getParsedProgramArgs(false);
  const root = options.dir || process.cwd();
  const status = await getPidFileStatus(root, mode);
  if (!status.type.file) {
    return {
      time: NaN,
      pid: null,
      running: false,
      path: status.path,
    };
  }
  const pid = await asyncTryCatchNull(fs.promises.readFile(status.path, "utf-8"));
  const valid = pid && typeof pid === "string" && pid !== "0" && !/\D/g.test(pid.trim());
  const running = valid && (await isProcessRunningByPid(pid));
  return {
    time: status.mtime,
    pid: valid ? parseInt(pid.trim()) : null,
    running,
    path: status.path,
  };
}
// ./src/modes/statusMode.js
/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initStatus(options) {
  let res;

  if (options.shutdown || options.restart) {
    console.log("Sending shutdown request...");
    await executeWrappedSideEffect("Spawn manager server", async () => {
      res = await sendInternalRequest("manager", "shutdown");
      options.debug && console.log("Status mode shutdown response:", res);
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
// ./src/modes/scheduleMode.js
// @ts-check












/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initScheduler(options) {
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
      console.log("The process is executing at pid", last.pid);
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
// ./src/process/spawnManagerProcess.js
async function spawnManagerProcess(debug = false, detached = true) {
  const logs = await getLastLogs(["mana"]);
  const list = logs.list.filter((f) => ["mana"].includes(path.basename(f.file).substring(0, 4)));
  console.log(`Spawning child manager script for ${JSON.stringify(logs.projectPath)}`, debug ? "in debug mode" : "");

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
      console.log("The process is executing at pid", last.pid);
    }
  } else {
    console.log("There are no previous manager log files");
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
  process.stdout.write("\n");
  console.log("Requesting status from manager process after spawning...");
  let success = false;
  for (let i = 0; i < 30 && !success; i++) {
    await sleep(200);
    try {
      const response = await sendInternalRequest("manager", "status");
      if (response?.error && typeof response.error === "string") {
        throw new Error(response.error);
      }
      if (response?.error) {
        throw new Error(`Failed to get status: ${JSON.stringify(response)}`);
      }
      if ((response.ok || response.success) && !response.error) {
        success = true;
        break;
      }
      if (i === 10) {
        console.log("Status check", i, "response:");
        console.log(response);
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
    throw new Error("Manager script could not be started: Status request not successfull");
  }
}

async function spawnChildScript(program, args, cwd, detached) {
  await sleep(500);
  return await executeProcessPredictably([program, ...args], cwd, {
    detached,
  });
}
// ./src/modes/processMode.js
global.debugProcess = true

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initProcessor(options) {
  if (options.dry && (options.restart || options.start || options.shutdown)) {
    const description = "Operating on manager process from processor";
    console.log(`Skipping side effect (dry-run enabled): ${description}`);
  } else {
    if (options.restart) {
      const result = await sendInternalRequest("manager", "restart");
      console.log("Restart response:", result && result.error && result.stage === "network" ? "(offline)" : result);
    } else if (options.shutdown) {
      const result = await sendInternalRequest("manager", "shutdown");
      console.log("Shutdown response:", result && result.error && result.stage === "network" ? "(offline)" : result);
    }
  }
  console.log("Started processor at", JSON.stringify(options.dir));

  const paths = await getInstancePathStatuses(options);
  const oldInstancePath = paths.old ? paths.old.path : "";
  const prevInstancePath = paths.prev.path;
  const currInstancePath = paths.curr.path;
  const nextInstancePath = paths.next.path;

  await waitForUniqueProcessor(paths.deploy.path, nextInstancePath);
  console.log("Waiting for unique processor finished");

  const execPurgeRes = await execPurge(oldInstancePath, prevInstancePath, currInstancePath, nextInstancePath);
  console.log(`execPurgeRes`, execPurgeRes);

  try {
    const execCheckoutRes = await execProcCheckout(options.dir, nextInstancePath, options.ref);
    console.log(`execCheckoutRes`, execCheckoutRes);
  } catch (error) {
    console.log(`Checkout step failed:`, error);
    await sleep(500);
    process.exit(1);
  }

  const filesToCopy = (process.env.PIPELINE_STEP_COPY ?? ".env,node_modules").split(",");
  const execCopyRes = await execCopy(options.dir, currInstancePath, nextInstancePath, filesToCopy);
  console.log(`execCopyRes`, execCopyRes);

  const isInstallEnabled = process.env.PIPELINE_STEP_INSTALL !== "off" && process.env.PIPELINE_STEP_INSTALL !== "0";
  if (isInstallEnabled) {
    if (!process.env.PIPELINE_STEP_INSTALL) {
      process.env.PIPELINE_STEP_INSTALL = "npm install";
    }
    const installRes = await execInstall(options.dir, nextInstancePath, process.env.PIPELINE_STEP_INSTALL);
    console.log(`installRes`, installRes);
  } else {
    console.log(`Install step skipped (disabled)`);
  }
  for (const cmd of [
    process.env.PIPELINE_STEP_PREBUILD,
    process.env.PIPELINE_STEP_BUILD,
    process.env.PIPELINE_STEP_TEST,
  ]) {
    if (!cmd || cmd === "false" || cmd === "0" || cmd === "off") {
      continue;
    }
    const execRes = await execScript(nextInstancePath, cmd);
    console.log(`execRes`, cmd, execRes);
  }
  if (!options.shutdown && process.env.PIPELINE_STEP_START !== "0" && process.env.PIPELINE_STEP_START !== "off") {
    console.log(`Sending project server replacement request`);
    const r = await execReplaceProjectServer(prevInstancePath, nextInstancePath, options.debug, options.sync);
    console.log(`execReplace`, r);
  }
  console.log(`Processor finished`);
}

async function waitForUniqueProcessor(deploymentPath, nextInstancePath) {
  const processPidFile = path.resolve(deploymentPath, "process.pid");
  const waitStart = new Date().getTime();
  let p;
  while (true) {
    p = await checkPathStatus(processPidFile);
    if (!p.type.file) {
      break;
    }
    const pid = await fs.promises.readFile(processPidFile);
    const running = await isProcessRunningByPid(pid);
    if (!running) {
      await fs.promises.unlink(processPidFile);
      break;
    }
    if (new Date().getTime() - waitStart < 30_000) {
      throw new Error(`Timeout while waiting for processor with pid ${pid} to finish`);
    }
    await sleep(500);
  }
  p = await checkPathStatus(nextInstancePath);
  if (p.type.file) {
    await sleep(100 + Math.random() * 100);
  }
  p = await checkPathStatus(processPidFile);
  if (p.type.file) {
    throw new Error(`Failed to lock pid file at "${processPidFile}"`);
  }
  p = await checkPathStatus(nextInstancePath);
  if (!p.type.file) {
    await executeWrappedSideEffect("Creating next instance path", async () => {
      await fs.promises.mkdir(path.resolve(p.path), { recursive: true });
    });
  }
  await executeWrappedSideEffect("Creating process pid file", async () => {
    await fs.promises.writeFile(processPidFile, process.pid.toString(), "utf-8");
    await sleep(100 + Math.random() * 50);
    const pid = await fs.promises.readFile(processPidFile, "utf-8");
    if (process.pid.toString().trim() !== pid.trim()) {
      throw new Error(`Failed to lock pid file at "${processPidFile}"`);
    }
  });
}

async function execPurge(oldInstancePath, prevInstancePath, currInstancePath, nextInstancePath) {
  debugProcess &&
    console.log("Executing purge", {
      prevInstancePath,
      currInstancePath,
      nextInstancePath,
    });
  const old = oldInstancePath && (await checkPathStatus(oldInstancePath)).type.dir;
  const prev = prevInstancePath && (await checkPathStatus(prevInstancePath)).type.dir;
  const curr = currInstancePath && (await checkPathStatus(currInstancePath)).type.dir;
  const next = nextInstancePath && (await checkPathStatus(nextInstancePath)).type.dir;

  if (oldInstancePath && old && prev) {
    debugProcess && console.log("Removing old instance path", { oldInstancePath });
    const result = await executeProcessPredictably(`rm -rf "${oldInstancePath}"`, path.dirname(oldInstancePath), {
      timeout: 10_000,
      shell: true,
    });
    console.log(result);
  }

  if (prevInstancePath && oldInstancePath && prev) {
    debugProcess && console.log("Moving previous instance path", oldInstancePath);
    await sleep(500);
    const result = await executeProcessPredictably(
      `mv -f "${prevInstancePath}" "${oldInstancePath}"`,
      path.dirname(prevInstancePath),
      { timeout: 10_000, shell: true }
    );
    console.log(result);
  }

  if (curr && currInstancePath && prevInstancePath) {
    debugProcess && console.log("Copying current instance files to", prevInstancePath);
    await sleep(500);
    const result = await executeProcessPredictably(
      `cp -rf "${currInstancePath}" "${prevInstancePath}"`,
      path.dirname(currInstancePath),
      { timeout: 10_000, shell: true }
    );
    console.log(result);
  }
  if (!next || !nextInstancePath) {
    return;
  }
  debugProcess && console.log("Removing upcoming production folder", { nextInstancePath });
  await sleep(500);
  // Remove new production folder
  const result = await executeProcessPredictably(`rm -rf "${nextInstancePath}"`, path.dirname(nextInstancePath), {
    timeout: 10_000,
    shell: true,
  });
  debugProcess && console.log("Removal of new production folder:", result);
  const newProdStat = await asyncTryCatchNull(fs.promises.stat(nextInstancePath));
  if (result.error || result.exit !== 0) {
    if (newProdStat) {
      const list = await asyncTryCatchNull(fs.promises.readdir(nextInstancePath));
      if (!(list instanceof Array) || list.length !== 0) {
        throw new Error(
          `Failed to remove new production folder: ${JSON.stringify({
            result,
          })}`
        );
      } else {
        debugProcess && console.log("Removal of new production folder failed but it is empty");
      }
    } else {
      debugProcess && console.log("Removal of new production folder failed but it does not exist");
    }
  }
  // Check
  for (let i = 0; i < 5; i++) {
    await sleep(50);
    const stat = await asyncTryCatchNull(fs.promises.stat(nextInstancePath));
    if (!stat) {
      continue;
    }
    const list = await asyncTryCatchNull(fs.promises.readdir(nextInstancePath));
    if (!(list instanceof Array) || list.length === 0) {
      continue;
    }
    throw new Error("Purge failed because there are files at next instance path after cleanup");
  }
  return true;
}

async function execProcCheckout(repositoryPath, nextInstancePath, ref) {
  debugProcess && console.log("Preparing checkout to", JSON.stringify(nextInstancePath));
  {
    const stat = await asyncTryCatchNull(fs.promises.stat(nextInstancePath));
    if (!stat) {
      // Create new production folder
      const result = await executeProcessPredictably(`mkdir "${nextInstancePath}"`, path.dirname(nextInstancePath), {
        timeout: 10_000,
        shell: true,
      });
      if (result.error || result.exit !== 0) {
        throw new Error(
          `Failed to create new production folder: ${JSON.stringify({
            result,
          })}`
        );
      }
    }
  }
  {
    const b = await checkPathStatus(nextInstancePath);
    debugProcess && console.log("Executing checkout from", JSON.stringify(repositoryPath));
    debugProcess && console.log("Before checkout file count:", b.children.length);
    let result;
    try {
      result = await executeGitCheckout(repositoryPath, nextInstancePath, ref);
      if (result.error || result.exit !== 0) {
        console.log(
          `Failed to checkout to new production folder: ${JSON.stringify({
            result,
          })}`
        );
      }
    } catch (err) {
      debugProcess && console.log("Checkout execution raised an error:", JSON.stringify(err.stack.trim()));
    }
    const s = await checkPathStatus(nextInstancePath);
    if (s.children.length) {
      debugProcess && console.log("Checkout target root files:", s.children);
    } else {
      debugProcess && console.log("Checkout did not generate any file at", JSON.stringify(nextInstancePath));
      debugProcess && console.log("Attempting git clone from:", JSON.stringify(repositoryPath));
      const cmd = `git clone . ${nextInstancePath}`;
      const result = await executeGitProcessPredictably(cmd, repositoryPath);
      if (result.error || result.exit !== 0) {
        throw new Error(
          `Failed to clone during checkout to new production folder: ${JSON.stringify({
            result,
          })}`
        );
      }
      const s = await checkPathStatus(nextInstancePath);
      debugProcess &&
        console.log("Clone target root file count:", s.children instanceof Array ? s.children.length : "?");
      if (!s.children.length) {
        throw new Error(`Could not find any file inside ${JSON.stringify(s.path)}`);
      }
    }
    debugProcess && console.log("Checkout successfull");
    return result;
  }
}

async function execCopy(
  repositoryPath,
  currInstancePath,
  nextInstancePath,
  files = ["data", ".env", "node_modules", "build"]
) {
  const repo = await checkPathStatus(repositoryPath);
  const curr = await checkPathStatus(currInstancePath);
  const next = await checkPathStatus(nextInstancePath);
  if (!repo.type.dir) {
    throw new Error(`Repository path not found at copy step: ${JSON.stringify(repositoryPath)}`);
  }
  if (!curr.type.dir || !next.type.dir) {
    console.log(
      "Skipping copy step because a instance folder was not found:",
      JSON.stringify({ currInstancePath, nextInstancePath })
    );
    return;
  }
  const sourceList = await Promise.all(files.map((f) => checkPathStatus([currInstancePath, f])));
  const targetList = await Promise.all(files.map((f) => checkPathStatus([nextInstancePath, f])));
  if (sourceList.every((s) => !s.type.file && !s.type.dir)) {
    console.log(
      "Skipping copy step because there are no source files that exist at:",
      JSON.stringify(currInstancePath)
    );
    return;
  }
  console.log("Executing copy step");
  for (let i = 0; i < sourceList.length; i++) {
    const s = sourceList[i];
    const t = targetList[i];
    if (s.type.file) {
      console.log("Copying file from", files[i]);
    } else if (s.type.dir) {
      if (t.type.file) {
        const a = await fs.promises.readFile(s.path, "utf-8");
        const b = await fs.promises.readFile(t.path, "utf-8");
        if (a === b) {
          console.log("Skipping unchanged", files[i]);
        }
      }
      console.log("Copying folder from", files[i]);
    } else {
      console.log("Skipping not found", files[i]);
      continue;
    }
    if (t.type.file || t.type.dir) {
      console.log("Removing existing target before coping:", JSON.stringify(t.path));
      const result = await executeProcessPredictably(`rm -rf "${t.path}"`, t.parent, {
        timeout: 10_000,
        shell: true,
      });
      if (result.error || result.exit !== 0) {
        throw new Error(`Failed to remove existing copy target: ${JSON.stringify(result)}`);
      }
    }
    const result = await executeProcessPredictably(`cp -r "${s.path}" "${t.path}"`, repositoryPath, {
      timeout: 10_000,
      shell: true,
    });
    if (result.error || result.exit !== 0) {
      throw new Error(
        `Failed to copy from ${JSON.stringify(s.path)} to ${JSON.stringify(t.path)}: ${JSON.stringify(result)}`
      );
    }
    console.log({ result });
  }
}

async function execInstall(repositoryPath, nextInstancePath, cmd = "") {
  console.log("Executing install step");
  const files = [
    { name: "package.json", source: null, target: null },
    { name: "package-lock.json", source: null, target: null },
    { name: "yarn.lock", source: null, target: null },
    { name: "node_modules", source: null, target: null },
  ];
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i].name;
    files[i].source = await asyncTryCatchNull(fs.promises.readFile(path.resolve(repositoryPath, fileName)));
    files[i].target = await asyncTryCatchNull(fs.promises.readFile(path.resolve(nextInstancePath, fileName)));
  }
  debugProcess &&
    console.log(
      "Install files from production folder:",
      files.filter((f) => f.source).map((f) => f.name)
    );
  debugProcess &&
    console.log(
      "Install files at new production folder:",
      files.filter((f) => f.target).map((f) => f.name)
    );
  const [pkg, pklock, yarnlock, nodemodules] = files;
  if (!pkg.target) {
    debugProcess && console.log('Install skipped because "package.json" was not found');
    return;
  }
  if (pkg.source === pkg.target && pklock.source && pklock.target && pklock.source === pklock.target) {
    debugProcess && console.log('Install skipped because both "package.json" and "package-lock.json" matched');
    return;
  }
  if (pkg.origin === pkg.target && yarnlock.origin && yarnlock.target && yarnlock.origin === yarnlock.target) {
    debugProcess && console.log('Install skipped because both "package.json" and "yarn.lock" matched');
    return;
  }
  if (cmd === "npm") {
    cmd = `${cmd} ${pklock.target ? "ci" : "install"}`;
  } else if (cmd === "yarn") {
    cmd = `${cmd} ${yarnlock.target ? "--frozen-lockfile" : ""}`;
  }
  debugProcess && console.log("Install command:", cmd);
  process.stdout.write("\n");
  const result = await executeProcessPredictably(cmd, nextInstancePath, {
    timeout: 180_000,
    shell: true,
    output: "inherit",
  });
  process.stdout.write("\n");
  if (result.error instanceof Error) {
    throw new Error(
      `Failed with error while installing dependencies with "${cmd}":\n${JSON.stringify(result.error.stack)}`
    );
  }
  if (result.error) {
    throw new Error(`Failed with while installing dependencies with "${cmd}":\n${JSON.stringify(result)}`);
  }
  if (result.exit !== 0) {
    throw new Error(
      `Failed with exit ${result.exit} while installing dependencies with "${cmd}":\n${JSON.stringify(result)}`
    );
  }
  const stat = await asyncTryCatchNull(fs.promises.readFile(path.resolve(nextInstancePath, "node_modules")));
  debugProcess &&
    console.log(
      "Installation finished",
      stat && !nodemodules.target
        ? '(created "node_modules")'
        : stat
        ? '(updated "node_modules")'
        : '("node_modules" was not generated)'
    );
  return result;
}

async function execScript(nextInstancePath, cmd = "", timeout = 60_000) {
  const pkgText = await asyncTryCatchNull(
    fs.promises.readFile(path.resolve(nextInstancePath, "package.json"), "utf-8")
  );
  if (cmd.startsWith("npm run")) {
    const pkg = typeof pkgText === "string" ? JSON.parse(pkgText) : null;
    if (!pkg || !pkg.scripts) {
      throw new Error(`Could not find scripts at "package.json": ${JSON.stringify(pkg)}`);
    }
  }
  process.stdout.write(`\n`);
  const result = await executeProcessPredictably(cmd, nextInstancePath, {
    timeout,
    output: (t) => process.stdout.write(t),
    shell: true,
  });
  if (result.error || result.exit !== 0) {
    throw new Error(
      `Failed to execute "${cmd}": ${JSON.stringify({
        ...result,
        start: undefined,
      })}`
    );
  }
  debugProcess && console.log(`Command ${JSON.stringify(cmd)} was successfull`);
}

async function execReplaceProjectServer(prevInstancePath, nextInstancePath, debug, sync) {
  return await executeWrappedSideEffect("Request upgrade to manager server", async () => {
    let res = await sendInternalRequest("manager", "restart", {
      prevInstancePath,
      nextInstancePath,
    });
    if (res.error && res.stage === "network") {
      console.log(`Upgrade request to manager failed (${res.stage})`);
      await spawnManagerProcess(debug, !sync);
      console.log(`Attempting to send upgrade request again`);
      res = await sendInternalRequest("manager", "restart", {
        prevInstancePath,
        nextInstancePath,
      });
    }
    console.log("Manager process upgrade response:");
    for (const line of JSON.stringify(res, null, "  ").split("\n")) {
      console.log(line);
    }
    return;
  });
}
// ./src/modes/configMode.js
global.canSkipConfirm = false

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initConfig(options) {
  if (!process.env.DEPLOYMENT_FOLDER_NAME) {
    process.env.DEPLOYMENT_FOLDER_NAME = "deployment";
  }
  if (!process.env.LOG_FOLDER_NAME) {
    process.env.LOG_FOLDER_NAME = "deployment";
  }
  canSkipConfirm = options.force;
  const obj = await interGetRepositoryPath(options);
  const targetPath = obj && obj.path && typeof obj.path === "string" ? obj.path : process.cwd();
  let status = await checkPathStatus(targetPath);
  if (!status.type.dir && !status.type.file && obj.confirmCreate !== true) {
    console.log(
      `Specified path does not exist ("${
        status.parent ? path.basename(targetPath) : path.basename(path.dirname(targetPath))
      }" ${status.type.dir ? "at" : "was not found at"} "${
        status.parent ? path.dirname(targetPath) : path.dirname(path.dirname(targetPath))
      }")`
    );
    const conf = await intConfirm(`Create and initialize a repository at "${path.basename(targetPath)}"?`);
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.confirmCreate = true;
    obj.confirmInit = true;
  }
  if (status.type.dir && (!status.type.bare || !status.type.proj) && obj.confirmInit !== true) {
    console.log(
      `Specified path exist ("${status.parent ? path.basename(targetPath) : path.basename(path.dirname(targetPath))}" ${
        status.type.dir ? "at" : "was not found at"
      } "${status.parent ? path.dirname(targetPath) : path.dirname(path.dirname(targetPath))}")`
    );
    const conf = await intConfirm(`Initialize a repository at "${path.basename(targetPath)}"?`);
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.confirmInit = true;
  }
  let initialized = false;
  if (!status.type.proj) {
    console.log("Initializing project target:", targetPath);
    await initializeGitRepositoryProject(targetPath, options.force, options);
    initialized = true;
    status = await checkPathStatus(targetPath);
    if (!status.type.proj) {
      console.log("Obs: Initializing project did not update status:", status.type);
    }
  }
  console.log("Updating path to:", targetPath, initialized ? "(after setup)" : "");
  process.chdir(targetPath);
  options.dir = targetPath;
  console.log("Verifying repository commit data...");
  const commitData = await getRepoCommitData(targetPath);
  if (commitData && commitData.error instanceof Error) {
    console.log("Could not load repository data:", commitData.error.message);
    throw new Error("Failed while reading latest repository commit data");
  } else {
    options.debug &&
      console.log(
        "Last commit was",
        `${getIntervalString(new Date().getTime() - commitData.date.getTime())} ago`,
        `(at ${getDateTimeString(commitData.date)})`
      );
    delete commitData.date;
    options.debug && console.log("Last commit data:", commitData);
  }
  options.debug && console.log("Requesting manager process status...");
  let res;
  let offline;
  res = await sendInternalRequest("manager", "status");
  offline = res.error && res.stage === "network";
  if (offline) {
    console.log(`Status request to manager failed to connect (${res.stage})`);
  }
  if (offline) {
    const detached = !options.sync;
    console.log("Attempting to spawn manager process", detached ? "detached" : "attached");
    const res = await spawnManagerProcess(options.debug, detached);
    console.log("Spawning of manager process resolved:", res);
    await sleep(500);
  }
  if (offline) {
    options.debug && console.log("Requesting manager process status...");
    offline = res.error && res.stage === "network";
  }
  console.log("Manager process response:");
  for (const line of JSON.stringify(res, null, "  ").split("\n")) {
    console.log(line);
  }
  intPause();
}

function isFileFromBareRepo(f) {
  if (f.endsWith(".log") || f.endsWith(".pid")) {
    return true;
  }
  if (f === (process.env.DEPLOYMENT_FOLDER_NAME || "deployment")) {
    return true;
  }
  if (f === (process.env.LOG_FOLDER_NAME || "deployment")) {
    return true;
  }
  if (
    [
      "branches",
      "config",
      "deployment",
      "description",
      "HEAD",
      "hooks",
      "index",
      "info",
      "objects",
      "refs",
      "FETCH_HEAD",
      "COMMIT_EDITMSG",
      "ORIG_HEAD",
    ].includes(f)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {import("../utils/checkPathStatus.js").PathStatus} status
 */
async function interVerifyTargetCandidate(status, isArg = false) {
  if (!status.parent) {
    console.log(`Specified path does not exist (Parent not found at "${path.dirname(path.resolve(status.path))}")`);
    const conf = await intConfirm(`Create and initialize a repository at "${path.basename(status.path)}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: true,
      origin: "no-parent",
    };
  }
  if (status.parent && !status.type.file && !status.type.dir) {
    const parent = await checkPathStatus(status.parent);

    // Find file name match
    if (parent.type.dir && parent.children instanceof Array) {
      const names = parent.children.filter(
        status.name.startsWith("*")
          ? (name) => name.endsWith(status.name.substring(1))
          : (name) =>
              name.startsWith(
                status.name.endsWith("*") ? status.name.substring(0, status.name.length - 1) : status.name
              )
      );
      if (!names.length && !status.name.endsWith(".git")) {
        names.push(`${status.name}.git`);
      }
      const checks = await Promise.all(names.map((name) => checkPathStatus([parent.path, name])));
      const match =
        checks.find((p) => p.type.proj) || checks.find((p) => p.type.bare) || checks.find((p) => p.type.dir);
      if (match) {
        console.log(`Specified path does not exist but "${match.name}" is a close match to "${status.name}"`);
        const conf = await intConfirm(
          `Select the existing ${
            match.type.bare
              ? "bare repository"
              : match.children.length === 0
              ? "empty folder"
              : `folder with ${match.children.length} files`
          } at "${match.path}"?`
        );
        if (conf) {
          return {
            path: status.path,
            confirmCreate: false,
            origin: "match",
          };
        }
      }
    }

    if (isArg) {
      console.log(
        `Specified path does not exist ("${status.name}" was not found at "${path.dirname(path.resolve(status.path))}")`
      );
    }
    const conf = await intConfirm(`Create and initialize "${path.basename(status.path)}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: true,
      confirmInit: true,
      origin: "not-found",
    };
  }
  if (status.type.proj) {
    console.log(`Specified project at "${status.path}"`);
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: false,
      origin: "target",
    };
  }
  if (status.type.bare) {
    console.log(`Specified unitialized repository at "${status.path}"`);
    const rname = status.name === ".git" ? path.basename(status.parent) : status.name;
    const conf = await intConfirm(`Initialize the repository "${rname}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: isArg ? "uninit-options" : "uninit",
    };
  }
  if (status.type.file) {
    console.log(
      `Specified path is not a folder ("${status.name}" is a file of "${path.dirname(path.resolve(status.parent))}")`
    );
    return;
  }
  if (status.type.dir && status.children.length === 0) {
    console.log(`Specified an empty folder ("${status.name}" at "${path.dirname(path.resolve(status.parent))}")`);
    const conf = await intConfirm(`Initialize a new git bare repository at "${status.name}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: "target",
    };
  }
  if (
    status.type.dir &&
    !status.children.includes("hooks") &&
    !status.children.includes("refs") &&
    !status.children.includes("config") &&
    status.children.includes(".git")
  ) {
    const s = await checkPathStatus([status.path, ".git"]);
    if (
      s.type.dir &&
      s.children.includes("hooks") &&
      s.children.includes("refs") &&
      s.children.includes("config") &&
      !s.children.includes(".git")
    ) {
      if (s.type.proj) {
        console.log(`Specified project at "${s.path}"`);
        return {
          path: s.path,
          confirmCreate: false,
          confirmInit: false,
          origin: "indirect",
        };
      } else if (s.type.bare) {
        console.log(`Specified unitialized git repository at "${s.path}"`);
        const rname = s.name === ".git" ? path.basename(s.parent) : s.name;
        const conf = await intConfirm(`Initialize the repository "${rname}"?`);
        if (!conf) {
          return;
        }
        return {
          path: s.path,
          confirmCreate: false,
          confirmInit: true,
          origin: "uninit",
        };
      }
    }
  }
  if (status.type.dir) {
    let message = "";
    const extras = status.children.filter((f) => !isFileFromBareRepo(f));
    if (extras.length <= 3) {
      console.log(`Specified folder "${status.name}" contains`, status.children.length, `children`);
      if (extras.length !== 0) {
        console.log(`Ignoring some unexpected files inside: ${extras.join(", ")}`);
      }
      message = `Initialize a new git bare repository at "${status.name}"?`;
    } else if (extras.length > 3) {
      console.log(
        `Specified folder "${status.name}" contains`,
        extras.length,
        "unexpected children out of",
        status.children.length
      );
      let line = `${extras.join(", ")}`;
      const limit = (process.stdout.columns || 80) - 8 - 1;
      if (line.length >= limit) {
        line = `${line.substring(0, limit - 5)}, ...`;
      }
      process.stdout.write(`\n`);
      process.stdout.write(`Path :  ${status.path}\n`);
      process.stdout.write(`Files:  ${line}\n`);
      process.stdout.write(`\n`);
      message = "Found unexpected contents. Are you sure you want to select this folder?";
    }
    const conf = await intConfirm(message);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: extras.length <= 3 ? "existing" : "existing-extra",
    };
  }
  throw new Error("Unhandled");
}

async function interGetRepositoryPath(options) {
  const result = {
    path: "",
    origin: "",
    confirmCreate: false,
    confirmInit: false,
  };
  let cand = null;
  const deployName = process.env.DEPLOYMENT_FOLDER_NAME || "deployment";
  if (options.dir) {
    cand = await checkPathStatus(options.dir);
    console.log(
      cand.type.proj
        ? "Project path"
        : cand.type.dir
        ? "Folder path"
        : cand.type.file
        ? "File path"
        : "Inexistant path",
      "from parameter:",
      cand.path
    );
    const v = await interVerifyTargetCandidate(cand, true);
    if (v?.path) {
      return v;
    }
  }
  cand = await checkPathStatus(process.cwd());
  if (cand.type.dir && (cand.type.bare || cand.type.proj)) {
    console.log("Selecting target from current folder as bare or proj:", cand.path);
    const v = await interVerifyTargetCandidate(cand, true);
    if (v?.path) {
      return v;
    }
  }
  if (cand.type.dir && !cand.children.includes("hooks") && cand.name === deployName) {
    cand = await checkPathStatus(cand.parent);
    if (
      cand.type.dir &&
      cand.children.includes("hooks") &&
      cand.children.includes("refs") &&
      cand.children.includes("config") &&
      !cand.children.includes(".git")
    ) {
      console.log("Selecting target from current folder as deployment folder:", cand.path);
      return await interVerifyTargetCandidate(cand, false);
    }
  }
  result.path = await intValid("Provide the git bare repository path", async (text) => {
    const res = await checkPathStatus(text.trim());
    const ver = await interVerifyTargetCandidate(res, false);
    if (ver?.path) {
      result.confirmCreate = ver.confirmCreate;
      result.confirmInit = ver.confirmInit;
      return ver.path;
    }
  });
  result.origin = "input";
  return result;
}

async function initializeGitRepositoryProject(targetPath, forceUpdate = false, options) {
  const status = await checkPathStatus(targetPath);
  console.log(
    `Initializing ${status.type.bare ? "the" : status.type.dir ? "an existing" : "a new"} git repository named`,
    JSON.stringify(path.basename(targetPath)),
    "inside a folder named",
    JSON.stringify(path.basename(path.dirname(targetPath)))
  );
  if (status.type.bare) {
    console.log(
      "Target git repository exists as a bare git repository",
      status.children.length === 0 ? "and is empty" : `and has ${status.children.length} children`
    );
  } else if (status.type.dir) {
    console.log(
      "Target folder exists",
      status.children.length === 0 ? "and is empty" : `and has ${status.children.length} children`
    );
  } else {
    await executeWrappedSideEffect("Create repository directory", async () => {
      await fs.promises.mkdir(targetPath, { recursive: true });
    });
  }
  if (!status.type.bare) {
    await executeWrappedSideEffect(
      "Initialize repository",
      async () => {
        const result = await executeGitProcessPredictably("git init --bare", targetPath);
        if (result.exit !== 0 || result.error) {
          console.log("Git init failed with exit code", result.exit);
          console.log(result);
          throw new Error("Git init failed");
        }
      },
      targetPath
    );
  }
  await initPostUpdateScript(targetPath);
  const deployFolderPath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME);
  const dep = await checkPathStatus(deployFolderPath);
  if (!dep.type.dir) {
    await executeWrappedSideEffect("Create deployment folder", async () => {
      await fs.promises.mkdir(deployFolderPath, { recursive: true });
      console.log("Created deployment folder at", deployFolderPath);
    });
  }
  const deployScriptPath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME, "node-deploy.cjs");
  const scr = await checkPathStatus(deployScriptPath);
  if (!scr.type.file || new Date().getTime() - scr.mtime > 15_000) {
    console.log("Checking the deployment script for the project");
    const possibleList = await Promise.all(
      [
        deployScriptPath,
        "./node-deploy.cjs",
        process.argv[1],
        path.resolve(process.argv[1]),
        path.resolve(path.dirname(path.resolve(process.cwd(), process.argv[1])), "node-deploy.cjs"),
      ].map((p) => checkPathStatus(p))
    );
    const candidates = possibleList.filter((f) => f.type.file && f.mtime);
    const lastUpdate = Math.max(...candidates.map((s) => s.mtime));
    const match = candidates.find((c) => c.mtime === lastUpdate);
    if (match) {
      console.log("Local deployment script path:", JSON.stringify(match.path));
      console.log("Local deployment script date:", getDateTimeString(match.mtime));
      console.log("Current deployment script file:", path.resolve(process.argv[1]));
    }
    let response;
    try {
      response = await fetchProjectReleaseFileSource();
      console.log(
        "Remote deployment script date:",
        response ? getDateTimeString(response.updated) : "(failed to fetch)"
      );
    } catch (err) {
      console.log("Remote deployment script could not be loaded:", err.message);
    }
    if (match && match.mtime && response && response.updated) {
      if (match.mtime > response.updated.getTime()) {
        console.log("Local file was updated after remote");
      } else {
        console.log("Local file was updated before remote");
      }
    }
    const fromRemote = response ? response.updated.getTime() : 0;
    const fromLocal = match ? 0 : new Date(match.mtime).getTime();
    let buffer;
    if (forceUpdate || fromLocal === 0 || (fromRemote && fromLocal + 50 < fromRemote)) {
      if (response?.buffer) {
        console.log("Writing deployment script from published remote");
        buffer = response.buffer;
      } else if (match && match !== candidates[0]) {
        console.log("Writing deployment script from local file:", match.path);
        buffer = await fs.promises.readFile(match.path);
      } else {
        throw new Error("Could not find updated deployment script source");
      }
    } else if (candidates[0].type.file && candidates[0].mtime === lastUpdate) {
      console.log("Current deployment script is most recent and will not be updated");
    } else {
      console.log("Writing deployment script from", JSON.stringify(match.path));
      buffer = await fs.promises.readFile(match.path);
    }
    if (buffer) {
      if (scr.type.file) {
        console.log("Skipping deployment script overwrite");
      } else {
        await executeWrappedSideEffect("Add deployment script", async () => {
          await fs.promises.writeFile(deployScriptPath, buffer);
          console.log("Deployment script ready at", JSON.stringify(deployScriptPath));
        });
      }
    }
  }
  await initializeConfigFile(targetPath, options);
  console.log(
    "Initialization of git repository finished for",
    JSON.stringify(path.basename(targetPath)),
    "at",
    JSON.stringify(path.dirname(targetPath))
  );
  const check = await checkPathStatus(targetPath);
  if (!check.type.proj && !canExecuteSideEffects()) {
    throw new Error("Failed initialization because target path is not a valid project after initializing");
  }
}

async function initializeConfigFile(targetPath, options) {
  const envFilePath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME || "deployment", ".env");
  const cfg = await checkPathStatus(envFilePath);
  const pairs = [];
  let original = "";
  if (cfg.type.file) {
    console.log("Loading config file from", JSON.stringify(envFilePath));
    original = await fs.promises.readFile(envFilePath, "utf-8");
    original = original.trim();
    const list = original
      .split("\n")
      .map((f) => (f.includes("=") ? f.trim() : ""))
      .filter((f) => f.length)
      .map((a) => [a.substring(0, a.indexOf("=")), a.substring(a.indexOf("=") + 1)]);
    if (cfg.type.file) {
      console.log("Loaded config file vars:", JSON.stringify(list.filter((f) => f[1].trim().length).map((a) => a[0])));
    }
    for (const [key, value] of list) {
      if (!value) {
        continue;
      }
      let pair = pairs.find((p) => p[0] === key);
      if (pair) {
        pair[1] = value;
      } else {
        pair = [key, value];
        pairs.push(pair);
      }
    }
  }
  const envKeyList = [
    "LOG_FOLDER_NAME",
    "DEPLOYMENT_FOLDER_NAME",
    "OLD_INSTANCE_FOLDER_PATH",
    "PREV_INSTANCE_FOLDER_PATH",
    "CURR_INSTANCE_FOLDER_PATH",
    "NEXT_INSTANCE_FOLDER_PATH",
    "PIPELINE_STEP_COPY",
    "PIPELINE_STEP_INSTALL",
    "PIPELINE_STEP_PREBUILD",
    "PIPELINE_STEP_BUILD",
    "PIPELINE_STEP_TEST",
    "PIPELINE_STEP_START",
  ];
  for (const key of envKeyList) {
    const value = process.env[key];
    if (!value) {
      continue;
    }
    let pair = pairs.find((p) => p[0] === key);
    if (pair) {
      pair[1] = value;
    } else {
      pair = [key, value];
      pairs.push(pair);
    }
  }
  console.log(cfg.type.file ? "Existing" : "Missing", "env config file of", targetPath, "has", pairs.length, "vars");
  const lines = [];
  for (const [name, value] of pairs) {
    lines.push(`${name}=${value}`);
  }

  let text = lines.join("\n") + "\n";
  if (!text.includes("INTERNAL_DATA_SERVER_PORT=")) {
    let p = 0;
    if (options.port) {
      console.log(`Appending the "port" argument parameter to the deployment config file`);
      p = options.port;
    } else {
      console.log(`Finding a "port" parameter to the internal server for the new config file`);
      const portList = [];
      for (let i = 49737; i < 49757; i++) {
        portList.push(i);
      }
      const list = await Promise.all(
        portList.map(
          (port) =>
            new Promise(async (resolve) => {
              const timer = setTimeout(() => resolve([0, null]), 500);
              try {
                const response = await sendInternalRequest(`http://127.0.0.1:${port}/`, "status");
                clearTimeout(timer);
                resolve([port, response]);
              } catch (err) {
                clearTimeout(timer);
                resolve([port, err]);
              }
            })
        )
      );
      const candidates = list.filter(
        ([port, res]) => port && !(res instanceof Error) && res && res.error && res.stage === "network"
      );
      let m = candidates.length > 0 ? candidates[Math.floor(candidates.length * Math.random())] : null;
      if (!m) {
        m = candidates[0];
      }
      if (!m) {
        options.debug && console.log("No port candidate from list of size", candidates.length);
        throw new Error(
          'Could not find a valid a port for the internal data server (specify it manually using the "--port" argument)'
        );
      }
      p = m[0];
    }
    options.debug && console.log("The internal manager port will be set to", p);
    if (p) {
      text = `${text}INTERNAL_DATA_SERVER_PORT=${p}\n`;
    }
  }
  if (original === text) {
    console.log("Maintaining the config file with", text.length, "bytes (no updates)");
  } else {
    console.log(cfg.type.file ? "Updating" : "Creating", "the config file at", envFilePath);
    await executeWrappedSideEffect(`${cfg.type.file ? "Update" : "Create"} config file`, async () => {
      await fs.promises.writeFile(envFilePath, text, "utf-8");
      console.log(`${cfg.type.file ? "Updated" : "Created"} deployment config file at`, JSON.stringify(envFilePath));
    });
  }
  return true;
}

async function initPostUpdateScript(targetPath) {
  console.log("Verifying post-update script");

  let s = await checkPathStatus(targetPath);
  if (s.type.dir && !s.children.includes("hooks") && !s.children.includes("refs") && s.children.includes(".git")) {
    const a = await checkPathStatus([targetPath, ".git"]);
    if (a.type.dir && a.children.includes("hooks") && a.children.includes("refs") && !a.children.includes(".git")) {
      targetPath = path.resolve(targetPath, ".git");
      s = a;
      console.log('Updated target repository path to ".git" folder');
    }
  }

  const updFilePath = path.resolve(targetPath, "hooks", "post-update");
  const updOriginal = await asyncTryCatchNull(fs.promises.readFile(updFilePath, "utf-8"));
  const updExists = typeof updOriginal === "string" && updOriginal.trim().length;

  let updSource = updExists ? updOriginal.trim() : "";
  if (!updSource.startsWith("#!")) {
    updSource = `#!/bin/bash\n${updSource}`;
  }
  if (!updSource.includes("--scheduler") && !updSource.includes("--processor")) {
    const line = `"${process.argv[0]}" ./${process.env.DEPLOYMENT_FOLDER_NAME}/node-deploy.cjs --scheduler $*`;
    updSource =
      updSource.substring(0, updSource.indexOf("\n") + 1) + line + updSource.substring(updSource.indexOf("\n") + 1);
  }
  const up = await checkPathStatus(updFilePath);
  if (!up.parent && !canExecuteSideEffects()) {
    throw new Error(`The post-update "hooks" folder was not found for "${updFilePath}"`);
  } else if (!up.parent) {
    console.log(`The post-update "hooks" folder was not found for "${updFilePath}"`);
  }
  if (!updExists || (updExists && updOriginal.trim() !== updSource.trim())) {
    console.log(updExists ? "Updating" : "Creating", "post-update hook");
    await sleep(400);
    await executeWrappedSideEffect(
      "Create and enable post-update hook",
      async (updateFilePath) => {
        await fs.promises.writeFile(updateFilePath, updSource, "utf-8");
        console.log("Created git hook file");
        const result = await executeProcessPredictably(`chmod +x "${updateFilePath}"`, targetPath, { shell: true });
        if (result.exit !== 0 || result.error) {
          console.log("Updating execution permission of git hook failed with exit code", result.exit);
          console.log(result);
          throw new Error("Updating execution permission of git hook failed");
        }
        console.log("Enabled git hook file");
      },
      updFilePath
    );
  }
}

function intPause() {
  if (!global["intResolve"]) {
    return;
  }
  global["intResolve"] = null;
  process.stdin.pause();
}
/**
 * Prompts the user with a message and waits for input
 * @param {string} subject - Message to display
 * @returns {Promise<string>}
 */
async function intQuery(subject = "") {
  if (!global["intResolve"]) {
    global["intResolve"] = () => {};
    process.stdin.on("data", (data) => global["intResolve"](data.toString("utf-8")));
  }
  if (typeof subject === "string") {
    console.log("User input", JSON.stringify(subject.substring(0, 32) + (subject.length > 32 ? "..." : "")));
    process.stdout.write(`\n`);
    process.stdout.write(`${subject} `);
  }
  while (true) {
    const text = await new Promise((r) => {
      global["intResolve"] = r;
    });
    return text;
  }
}
/**
 * Asks the user a yes/no question
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>}
 */
async function intConfirm(question = "") {
  question = `${question} [y/n] `.trim();
  while (true) {
    if (canSkipConfirm) {
      console.log(`${question} (auto-confirm)`);
      return true;
    }
    const t = await intQuery(`${question} `);
    process.stdout.write("\n");
    if (t.trim().startsWith("y")) {
      return true;
    } else if (t.trim().startsWith("n")) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Validates user input based on a provided function
 * @param {string} subject - Prompt message
 * @param {(text: string) => Promise<boolean | string | Error | null | undefined>} func - Validation function
 * @returns {Promise<string>} - Validated user input
 */
async function intValid(subject = "", func = async (t) => false) {
  while (true) {
    const text = await intQuery(`${subject}:`);
    try {
      const result = await func(text);
      if (result === true) {
        return text;
      }
      if (typeof result === "string" && result) {
        return result;
      }
      if (result instanceof Error) {
        throw result;
      }
      console.log("Invalid. Try again.");
    } catch (err) {
      console.log(`Invalid: ${err.message}. Try again.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Allows the user to select an option from a provided list
 * @param {string} subject - Prompt message
 * @param {string[]} options - List of selectable options
 * @param {boolean} [printOptions] - Whether or not to display the options
 * @returns {Promise<string|void>} - Selected option
 */
async function intSelect(subject = "", options = [], printOptions = false) {
  return await intValid(subject + printOptions ? options.map((o) => `\n  ${o}`).join("") : "", async (i) => {
    const option = options.find((o) => o.trim() === i.trim());
    if (!option) {
      return;
    }
    return option;
  });
}
// ./src/lib/getProgramArgs.js
/**
 * @typedef {Object} Options
 * @property {boolean} debug - Indicates if debug mode is enabled
 * @property {boolean} force - Indicates if "force" option is enabled
 * @property {boolean} dry - Indicates if "dry" run mode is enabled
 * @property {boolean} sync - Indicates if "sync" run mode is enabled
 * @property {boolean} start - Indicates if manager server should be started
 * @property {boolean} restart - Indicates if manager server should be restarted
 * @property {boolean} shutdown - Indicates if manager server should be shutdown
 * @property {string} mode - The program mode for the options
 * @property {string} ref - The version hash for deployment
 * @property {string} dir - The target project repository path
 * @property {string} port - The port to use for the internal server
 */

function getBaseProgramArgs() {
  return {
    debug: true,
    force: false,
    dry: false,
    sync: false,
    start: false,
    restart: false,
    shutdown: false,
    mode: "",
    ref: "",
    dir: "",
    port: "",
  };
}

/**
 * @typedef {(options: Options) => Promise<void>} InitModeMethod
 */

/**
 * @type {Record<string, InitModeMethod>}
 */
global.programEntryRecord = {
  help: initHelp,
  logs: initLogs,
  setup: initConfig,
  config: initConfig,
  status: initStatus,
  schedule: initScheduler,
  process: initProcessor,
  manager: initManager,
  upgrade: initUpgrade,
};

global.modes = Object.keys(programEntryRecord)

/**
 * @param {string} mode
 * @returns {(options: Options) => Promise<void>}
 */
function getInitForMode(mode = "setup") {
  if (mode === "runtime") {
    mode = "logs";
  }
  if (!programEntryRecord[mode]) {
    throw new Error(`Invalid mode: ${JSON.stringify(mode)}`);
  }
  return programEntryRecord[mode];
}

/**
 * @param {string[]} args
 * @param {Partial<Options>} options
 * @param {string[]} remaining
 * @param {Record<string, number>} indexes
 */
function parseProgramArgs(args = process.argv.slice(2), options = {}, remaining = [], indexes = {}) {
  const debug =
    options.debug || Boolean(args.find((a) => ["--debug", "-debug", "-d", "--verbose", "-verbose", "-v"].includes(a)));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (indexes.debug === undefined && ["--debug", "-debug", "-d", "--verbose", "-verbose", "-v"].includes(arg)) {
      indexes.debug = i;
      options.debug = true;
      debug && console.log("[Arg]", i, "set ", ["debug", arg]);
      continue;
    }
    if (indexes.port === undefined && ["--port", "--manager-port", "--mport", "--tcp", "-port"].includes(arg) && arg[i+1] && !/\D/g.test(arg[i+1])) {
      indexes.port = i;
      options.port = args[i+1];
      debug && console.log("[Arg]", i, "prep", ["port", arg]);
      debug && console.log("[Arg]", i, "set ", ["port", options.port]);
      i++;
      continue;
    }
    if (indexes.force === undefined && ["--force", "--yes", "-y"].includes(arg)) {
      indexes.force = i;
      options.force = true;
      debug && console.log("[Arg]", i, "set ", ["force", arg]);
      continue;
    }
    if (indexes.sync === undefined && ["--sync", "--syncronous", "--wait", "--sync", "--attached"].includes(arg)) {
      indexes.sync = i;
      options.sync = true;
      debug && console.log("[Arg]", i, "set ", ["sync", arg]);
      continue;
    }
    if (indexes.dry === undefined && ["--dry", "--dry-run", "--dryrun", "--simulate", "--sim"].includes(arg)) {
      indexes.dry = i;
      options.dry = true;
      debug && console.log("[Arg]", i, "set ", ["dry", arg]);
      continue;
    }
    if (["--help", "-h", "--h", "--?", "-?", "/?", "/?"].includes(arg)) {
      indexes.mode = i;
      options.mode = "help";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      continue;
    }
    const canBeMode = indexes.mode === undefined;
    if (
      (canBeMode || options.mode === "status") &&
      indexes.start === undefined &&
      ["--start", "--spawn", "--on", "--activate", "-start", "-spawn", "-on"].includes(arg)
    ) {
      options.mode = "status";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      indexes.start = i;
      options.start = true;
      debug && console.log("[Arg]", i, "set ", ["start", arg]);
      continue;
    }
    if (
      (canBeMode || options.mode === "status") &&
      indexes.restart === undefined &&
      ["--restart", "--reset", "--reload", "--rst", "-restart", "-reset", "-reload", "-rst"].includes(arg)
    ) {
      options.mode = "status";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      indexes.restart = i;
      options.restart = true;
      debug && console.log("[Arg]", i, "set ", ["restart", arg]);
      continue;
    }
    if (
      (!options.mode || options.mode === "logs") &&
      ["--runtime", "--instance", "--app", "--ins", "--stream", "-app", "-ins"].includes(arg)
    ) {
      indexes.mode = i;
      options.mode = "runtime";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      continue;
    }
    if (
      canBeMode &&
      indexes.shutdown === undefined &&
      ["--shutdown", "--disable", "--off", "--deactivate", "-shutdown", "-disable", "-off"].includes(arg)
    ) {
      options.mode = "status";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      indexes.shutdown = i;
      options.shutdown = true;
      debug && console.log("[Arg]", i, "set ", ["shutdown", arg]);
      continue;
    }
    if (!options.ref && ["schedule", "process"].includes(options.mode || "") && i - 1 === indexes.mode) {
      let isRef = !arg.includes('.') && !arg.includes('!') && (arg.startsWith("refs/") || arg.startsWith("HEAD"));
      if (!isRef && fs.existsSync(path.resolve(options.dir || process.cwd(), arg, 'config')) && fs.existsSync(path.resolve(options.dir || process.cwd(), arg, 'hooks'))) {
        isRef = false;
      }
      if (isRef) {
        indexes.ref = i;
        options.ref = arg;
        debug && console.log("[Arg]", i, "set ", ["ref", options.ref]);
        if (arg.toLowerCase().substring(0, 4) === "head") {
          debug && console.log("Ref parameter starts with current reference point");
        } else if (arg.startsWith("refs/")) {
          debug && console.log("Ref parameter starts with branch reference name");
        } else if (
          arg.length >= 6 &&
          arg.length <= 50 &&
          !arg.includes("/") &&
          !arg.includes("\\") &&
          !arg.includes(" ") &&
          !arg.includes("_") &&
          !arg.includes(".") &&
          !arg.includes(",") &&
          arg
            .toUpperCase()
            .replace(/\d/g, "")
            .split("")
            .every((c) => c.charCodeAt(0) >= "A".charCodeAt(0) && c.charCodeAt(0) <= "Z".charCodeAt(0))
        ) {
          debug && console.log("Ref parameter looks like a commit hash of size", arg.length);
        } else {
          console.log("Warning: Reference parameter of size", arg.length, "has an unexpected format");
          debug && console.log("Parameter does not look like a normal git reference:", JSON.stringify(arg));
        }
        continue;
      }
    }
    const isPathLike =
      !arg.startsWith("refs/heads/") &&
      !arg.startsWith("-") &&
      (arg.includes("/") || arg.includes("\\") || arg.startsWith("."));
    if (isPathLike && indexes.mode === undefined) {
      indexes.mode = i;
      options.mode = "config";
      debug && console.log("[Arg]", i, "made", ["mode", options.mode]);
      indexes.dir = i;
      options.dir = arg;
      debug && console.log("[Arg]", i, "set ", ["dir", options.dir]);
      continue;
    }
    const letters = arg.replace(/\W/g, "").toLowerCase();
    const match = modes.find(
      (k) =>
        (letters === "l" && k === "logs") ||
        (letters === "s" && k === "status") ||
        k.substring(0, 4).toLowerCase() === letters.substring(0, 4)
    );
    if (
      match &&
      (indexes.mode === undefined ||
        (options.mode === "runtime" && match === "logs") ||
        (options.mode === "logs" && match === "runtime") ||
        match === options.mode)
    ) {
      if (options.mode === "runtime" || match === "runtime") {
        options.mode = "runtime";
      } else {
        options.mode = match;
      }
      indexes.mode = i;
      options.debug && console.log("[Arg]", i, "set ", ["mode", options.mode], "from", arg);
      continue;
    }
    if (indexes.dir === undefined && !arg.startsWith("-") && !arg.startsWith("refs/heads/")) {
      indexes.dir = i;
      options.dir = arg;
      debug && console.log("[Arg]", i, "set ", ["dir", arg]);
      continue;
    }
    remaining.push(arg);
  }
  if (!options.mode) {
    options.mode = "setup";
  }
  if (options.mode !== "schedule" && options.sync) {
    console.log(`Warning: Syncronous flag only works in "schedule" mode, current mode is "${options.mode}"`);
  }
  return {
    options,
    indexes,
    remaining,
  };
}

/**
 * @type {Options | undefined}
 */
global.parsed = undefined

function getParsedProgramArgs(ignoreCache = false) {
  /** @type {string[]} */
  const remaining = [];
  if (!parsed || ignoreCache) {
    parsed = getBaseProgramArgs();
    parseProgramArgs(process.argv.slice(2), parsed, remaining);
    if (!parsed.mode) {
      parsed.mode = "setup";
    }
  }
  if (parsed.sync && parsed.mode !== "schedule") {
    console.log(
      `Warning: Syncronous flag argument only works in "schedule" mode, but current mode is "${parsed.mode}"`
    );
  }
  if (parsed.ref && !["schedule", "process"].includes(parsed.mode)) {
    console.log(
      `Warning: Checkout reference argument only works in "status", "schedule", or "process" mode, but current mode is "${parsed.mode}"`
    );
  }
  return {
    options: parsed,
    remaining,
  };
}

function isDebug() {
  return parsed && parsed.debug;
}
// ./src/modes/managerMode.js
global.lastPid = 0
global.instancePath = ""
global.terminating = false
global.stopping = false
global.child = null
global.server = null

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
async function initManager(options) {
  if (options.dry) {
    console.log('Warning: The manager process ignores the "dry" parameter');
  }
  const root = options.dir || process.cwd();
  const deployFolderPath = path.resolve(root, process.env.DEPLOYMENT_FOLDER_NAME || 'deployment');
  if (!fs.existsSync(deployFolderPath)) {
    throw new Error(`Cannot start manager because deployment folder was not found at ${JSON.stringify(deployFolderPath)}`)
  }
  if (options.port && process.env.INTERNAL_DATA_SERVER_PORT !== options.port) {
    process.env.INTERNAL_DATA_SERVER_PORT = options.port;
    const envFilePath = path.resolve(deployFolderPath, '.env');
    if (!fs.existsSync(envFilePath)) {
      throw new Error(`Cannot start manager because config file was not found at ${JSON.stringify(envFilePath)}`);
    }
    let text = await fs.promises.readFile(envFilePath, 'utf-8');
    if (!text.endsWith('\n')) {
      text = `${text}\n`;
    }
    if (!text.includes('INTERNAL_DATA_SERVER_PORT=')) {
      console.log(`Applying "port" parameter (${options.port}) to config file`);
      text = `${text}INTERNAL_DATA_SERVER_PORT=${options.port}\n`;
      if (!options.dry) {
        await fs.promises.writeFile(envFilePath, text, 'utf-8');
      }
      console.log('Updated config file at:', JSON.stringify(envFilePath.replace(/\\/g, '/')));
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
        console.log('Run deployer by pushing changes or by running this script with the "--processor" argument ');
        console.log("Skipping instance initialization");
      } else {
        if (curr && curr.path && curr.type.dir) {
          console.log("Starting instance child...");
          const result = await startInstanceChild(data.hash);
          console.log("Start instance child result:");
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
    const promise = startInstanceChild(data?.nextInstancePath);
    promise
      .then((r) => {
        status = "resolved";
        console.log("Instance spawn result", r);
      })
      .catch((e) => {
        status = "failed";
        console.log("Instance spawn error", e);
      });
    await sleep(1000);
    if (status !== "") {
      console.log("Instance process", status, "imediately after spawn");
    }
    const logs = await getLastLogs(["instance"]);
    const pres = await getRunningChildInstanceProcess();
    const pid = pres.pid || lastPid;
    const runs = pid ? await isProcessRunningByPid(pid) : false;
    console.log("Verifying instance pid from", JSON.stringify(pres.source), runs ? "(running)" : "(not running)");
    return {
      success: true,
      reason: `${url === "/api/restart" ? "Restarted" : "Started"} instance process`,
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
// ./index.js
loadEnvSync([process.cwd()], process.env);

global.parsed = getParsedProgramArgs()

if (parsed.sync && parsed.mode !== "schedule") {
  console.log(`Warning: Syncronous flag argument only works in "schedule" mode, but current mode is "${parsed.mode}"`);
}

if (parsed.ref && !["schedule", "process"].includes(parsed.mode)) {
  console.log(
    `Warning: The reference argument is ignored in the current program mode (got "${parsed.mode}" and expected "schedule" or "processor")`
  );
}

global.persistLogs = !["help", "logs", "runtime"].includes(parsed.options.mode)
attachToConsole(
  "log",
  persistLogs
    ? path.resolve(
        process.cwd(),
        process.env.LOG_FOLDER_NAME || process.env.DEPLOYMENT_FOLDER_NAME || "deployment",
        `${["runtime"].includes(parsed.options.mode) ? "logs" : parsed.options.mode}.log`
      )
    : "",
  ["help", "logs", "runtime"].includes(parsed.options.mode)
);

global.valid = true
if (["status", "logs", "runtime", "schedule", "process", "manager"].includes(parsed.options.mode)) {
  valid = false;
  let info = checkPathStatusSync(parsed.options.dir || process.cwd());
  // Enter .git if it exists and deployment folder doesnt
  const deployName = process.env.DEPLOYMENT_FOLDER_NAME || "deployment";
  if (
    info.type.dir &&
    !info.children.includes("config") &&
    info.children.includes(".git") &&
    !info.children.includes(deployName)
  ) {
    const next = checkPathStatusSync([info.path, ".git"]);
    if (next.type.dir && next.children.includes("config") && next.children.includes("hooks")) {
      parsed.options.debug && console.log('Updating path to enter ".git" folder');
      info = next;
      parsed.options.dir = info.path;
    }
  }
  // Exit deployment folder if inside
  if (
    info.type.dir &&
    info.name === deployName &&
    info.children.includes("node-deploy.cjs") &&
    !info.children.includes("hooks") &&
    !info.children.includes("refs")
  ) {
    const par = checkPathStatusSync(info.parent);
    if (
      par.type.dir &&
      par.children.includes("hooks") &&
      par.children.includes("refs") &&
      par.children.includes("config")
    ) {
      parsed.options.debug && console.log('Updating path to exit "deployment" folder');
      info = par;
      parsed.options.dir = info.path;
    }
  }
  // Find deployment folder
  let deploy = checkPathStatusSync(path.resolve(info.path, deployName));
  let cfg = checkPathStatusSync(path.resolve(deploy.path, ".env"));
  valid = info.type.dir && deploy.type.dir && cfg.type.file;
  if (!valid && info.name === deployName) {
    info = checkPathStatusSync(path.dirname(info.path));
    deploy = checkPathStatusSync(path.resolve(info.path, deployName));
    cfg = checkPathStatusSync(path.resolve(deploy.path, ".env"));
    valid = info.type.dir && deploy.type.dir && cfg.type.file;
  }
  if (!valid && info.type.dir && info.children.includes(".git")) {
    info = checkPathStatusSync(path.resolve(info.path, ".git"));
    deploy = checkPathStatusSync(path.resolve(info.path, deployName));
    cfg = checkPathStatusSync(path.resolve(deploy.path, ".env"));
    valid = info.type.dir && deploy.type.dir && cfg.type.file;
  }
  if (valid && !cfg.type.file) {
    console.log(`Cannot initialize mode because the config file was not found: ${JSON.stringify(".env")}`);
    valid = false;
  }
  if (!parsed.options.dir || parsed.options.dir !== info.path) {
    // parsed.options.debug && console.log("Current project path is", parsed.options.dir);
    parsed.options.dir = info.path;
    parsed.options.debug && console.log("Updated project path is", info.path);
  }

  const local = loadEnvSync([cfg.parent, cfg.path, cfg.parent ? path.resolve(cfg.parent, deployName) : '', cfg.path ? path.resolve(cfg.path, deployName) : ''], {});
  const updated = [];
  for (const key in local) {
    if (process.env[key] === local[key]) {
      continue;
    }
    if (!local[key] && local[key] !== "0") {
      continue;
    }
    if ((key === "DEPLOYMENT_FOLDER_NAME" || key === "LOG_FOLDER_NAME") && local[key] === "deployment") {
      process.env[key] = local[key];
      continue;
    }
    updated.push(`Env "${key}" set to ${JSON.stringify(local[key])}`);
    console.log("Updating", key, "from", process.env[key] === undefined ? '(nothing)' : process.env[key], "to", local[key]);
    process.env[key] = local[key];
  }
  const targetCwd = path.resolve(info.path);
  if (updated.length) {
    parsed.options.debug && console.log("Updated environment vars:", updated);
  } else {
    parsed.options.debug && console.log("Nothing to update in environment vars");
  }
  process.chdir(targetCwd);
}

if (!valid) {
  console.log(
    `Cannot initialize "${parsed.options.mode}" mode at ${JSON.stringify(parsed.options.dir || process.cwd())}`
  );
} else if (parsed.remaining.length === 1) {
  console.log(`Invalid program argument: ${JSON.stringify(parsed.remaining[0])}`);
  valid = false;
} else if (parsed.remaining.length) {
  console.log(`Invalid program arguments: ${JSON.stringify(parsed.remaining)}`);
  valid = false;
}

if (valid) {
  const initMethod = getInitForMode(parsed.options.mode);

  if (!initMethod) {
    console.log(`Invalid program mode: ${JSON.stringify(process.argv)}`);
    setTimeout(() => process.exit(1), 100);
  }

  parsed.options.debug &&
    console.log(`Starting script in "${parsed.options.mode}" mode${parsed.options.dry ? " in dry mode" : ""}`);

  initMethod(parsed.options).catch((err) => {
    console.log(err);
    setTimeout(() => process.exit(1), 100);
  });
} else {
  setTimeout(() => process.exit(1), 100);
}

//getRepoCommitDataUnsafe('./.git/deployment', '').then(console.log).catch(console.log);