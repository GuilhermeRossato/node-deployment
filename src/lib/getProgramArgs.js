import fs from "node:fs";
import path from "node:path";
import { initManager } from "../modes/managerMode.js";
import { initScheduler } from "../modes/scheduleMode.js";
import { initConfig } from "../modes/configMode.js";
import { initStatus } from "../modes/statusMode.js";
import { initLogs } from "../modes/logsMode.js";
import { initProcessor } from "../modes/processMode.js";
import { initHelp } from "../modes/helpMode.js";
import { initUpgrade } from "../modes/upgradeMode.js";

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
  };
}

/**
 * @typedef {(options: Options) => Promise<void>} InitModeMethod
 */

/**
 * @type {Record<string, InitModeMethod>}
 */
const programEntryRecord = {
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

const modes = Object.keys(programEntryRecord);

/**
 * @param {string} mode
 * @returns {(options: Options) => Promise<void>}
 */
export function getInitForMode(mode = "setup") {
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
export function parseProgramArgs(args = process.argv.slice(2), options = {}, remaining = [], indexes = {}) {
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
      const argExists = arg.includes("~") ? false : fs.existsSync(path.resolve(options.dir || process.cwd(), arg));
      if (!argExists || arg.toLowerCase() === "head") {
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
let parsed = undefined;

export function getParsedProgramArgs(ignoreCache = false) {
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

export function isDebug() {
  return parsed && parsed.debug;
}
