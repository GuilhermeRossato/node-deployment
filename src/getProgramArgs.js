import fs from "node:fs";
import path from "node:path";
import { initManager } from "./modes/managerMode.js";
import { initScheduler } from "./modes/scheduleMode.js";
import { initConfig } from "./modes/configMode.js";
import { initStatus } from "./modes/statusMode.js";
import { initLogs } from "./modes/logsMode.js";
import { initProcessor } from "./modes/processMode.js";
import { initHelp } from "./modes/helpMode.js";

/**
 * @typedef {Object} Options
 * @property {boolean} debug - Indicates if debug mode is enabled
 * @property {boolean} yes - Indicates if "yes" option is enabled
 * @property {boolean} dry - Indicates if "dry" run mode is enabled
 * @property {boolean} sync - Indicates if "sync" run mode is enabled
 * @property {boolean} start - Indicates if manager server should be started
 * @property {boolean} restart - Indicates if manager server should be restarted
 * @property {boolean} shutdown - Indicates if manager server should be shutdown
 * @property {string} mode - The program mode for the options
 * @property {string} ref - The version hash for deployment
 * @property {string} dir - The target project repository path
 */

/**
 * @type {Record<string, (options: Options) => Promise<void>>}
 */
const initRecord = {
  help: initHelp,
  logs: initLogs,
  setup: initConfig,
  config: initConfig,
  status: initStatus,
  schedule: initScheduler,
  process: initProcessor,
  manager: initManager,
};

const modes = Object.keys(initRecord);

/**
 * @param {string} mode
 * @returns {(options: Options) => Promise<void>}
 */
export function getInitForMode(mode = "setup") {
  if (!initRecord[mode]) {
    throw new Error(`Invalid mode: ${JSON.stringify(mode)}`);
  }
  return initRecord[mode];
}

/**
 * @param {string[]} args
 * @param {Partial<Options>} options
 * @param {string[]} remaining
 * @param {Record<string, number>} indexes
 * @returns
 */
export function parseProgramArgs(
  args = process.argv.slice(2),
  options = {},
  remaining = [],
  indexes = {}
) {
  options.debug = options.debug || Boolean(args.find(a => ["--debug", "-debug", "-d", "--verbose", "-verbose", "-v"].includes(a)));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      indexes.debug === undefined &&
      ["--debug", "-debug", "-d", "--verbose", "-verbose", "-v"].includes(arg)
    ) {
      indexes.debug = i;
      options.debug = true;
      options.debug && console.log('Arg', i, 'set ', ['debug', arg]);
      continue;
    }
    if (indexes.yes === undefined && ["--yes", "-y"].includes(arg)) {
      indexes.yes = i;
      options.yes = true;
      options.debug && console.log('Arg', i, 'set ', ['yes', arg]);
      continue;
    }
    if (
      indexes.sync === undefined &&
      ["--sync", "--syncronous", "--wait", "--sync", "--attached"].includes(arg)
    ) {
      indexes.sync = i;
      options.sync = true;
      options.debug && console.log('Arg', i, 'set ', ['sync', arg]);
      continue;
    }
    if (
      indexes.dry === undefined &&
      [
        "--dry",
        "--dry-run",
        "--dryrun",
        "--simulate",
        "--sim",
        "--pretend",
      ].includes(arg)
    ) {
      indexes.dry = i;
      options.dry = true;
      options.debug && console.log('Arg', i, 'set ', ['dry', arg]);
      continue;
    }
    if (
      indexes.mode === undefined &&
      indexes.start === undefined &&
      [
        "--start",
        "--spawn",
        "--on",
        "--activate",
        "-start",
        "-spawn",
        "-on",
      ].includes(arg)
    ) {
      indexes.mode = i;
      options.mode = "status";
      options.debug && console.log('Arg', i, 'made', ['mode', options.mode]);
      indexes.start = i;
      options.start = true;
      options.debug && console.log('Arg', i, 'set ', ['start', arg]);
      continue;
    }
    if (
      indexes.mode === undefined &&
      indexes.restart === undefined &&
      [
        "--restart",
        "--reset",
        "--reload",
        "--rst",
        "-restart",
        "-reset",
        "-reload",
        "-rst",
      ].includes(arg)
    ) {
      indexes.mode = i;
      options.mode = "status";
      options.debug && console.log('Arg', i, 'made', ['mode', options.mode]);
      indexes.restart = i;
      options.restart = true;
      options.debug && console.log('Arg', i, 'set ', ['restart', arg]);
      continue;
    }
    if (
      (indexes.mode === undefined || options.mode === "status") &&
      indexes.shutdown === undefined &&
      [
        "--shutdown",
        "--disable",
        "--off",
        ,
        "--deactivate",
        "-shutdown",
        "-disable",
        "-off",
      ].includes(arg)
    ) {
      indexes.mode = i;
      options.mode = "status";
      options.debug && console.log('Arg', i, 'made', ['mode', options.mode]);
      indexes.shutdown = i;
      options.shutdown = true;
      options.debug && console.log('Arg', i, 'set ', ['shutdown', arg]);
      continue;
    }
    if (
      indexes.ref === undefined &&
      ["schedule", "process"].includes(options.mode || "") &&
      i - 1 === indexes.mode
    ) {
      const argExists = fs.existsSync(path.resolve(options.dir || process.cwd(), arg));
      if (!argExists) {
        const isRefLike = arg.startsWith("refs/") || ([7, 8, 40].includes(arg.length) && /^[0-9a-fA-F]{40}$/.test(arg));
        if (!isRefLike) {
          console.log('Warning: Reference parameter has unexpected structure');
        }
        indexes.ref = i;
        options.ref = arg;
        options.debug && console.log('Arg', i, 'set ', ['ref', options.ref]);
        continue;
      }
    }
    const isPathLike =
      !arg.startsWith("-") &&
      (arg.includes("/") || arg.includes("\\") || arg.startsWith("."));
    if (isPathLike && indexes.mode === undefined) {
      indexes.mode = i;
      options.mode = "config";
      options.debug && console.log('Arg', i, 'made', ['mode', options.mode]);
      indexes.dir = i;
      options.dir = arg;
      options.debug && console.log('Arg', i, 'set ', ['dir', options.dir]);
      continue;
    }
    if (indexes.mode === undefined) {
      const mode = arg.replace(/\W/g, "").toLowerCase();
      const match = modes.find(
        (k) => k.substring(0, 4).toLowerCase() === mode.substring(0, 4)
      );
      if (match) {
        indexes.mode = i;
        options.mode = match;
        options.debug && console.log('Arg', i, 'set ', ['mode', options.mode], 'from', arg);
        continue;
      }
    }
    if (indexes.dir === undefined && !arg.startsWith("-")) {
      indexes.dir = i;
      options.dir = arg;
      options.debug && console.log('Arg', i, 'set ', ['dir', arg]);
      continue;
    }
    remaining.push(arg);
  }
  if (!options.mode) {
    options.mode = "setup";
  }
  if (options.mode !== "schedule" && options.sync) {
    console.log(
      `Warning: Syncronous flag only works in "schedule" mode, current mode is "${options.mode}"`
    );
  }
  return {
    options,
    indexes,
    remaining,
  };
}

export function getCachedParsedProgramArgs() {
  /** @type {Options}  */
  let options = {
    debug: true,
    yes: false,
    dry: false,
    sync: false,
    start: false,
    restart: false,
    shutdown: false,
    mode: "",
    ref: "",
    dir: "",
  };
  /** @type {string[]} */
  let remaining = [];
  if (getCachedParsedProgramArgs["cache"]) {
    options = getCachedParsedProgramArgs["cache"].options;
    remaining = getCachedParsedProgramArgs["cache"].remaining;
  } else {
    parseProgramArgs(process.argv.slice(2), options, remaining);
    if (!options.mode) {
      options.mode = "setup";
    }
    if (options.sync && options.mode !== "schedule") {
      console.log(
        `Warning: Syncronous flag argument only works in "schedule" mode, but current mode is "${options.mode}"`
      );
    }
    if (
      options.ref &&
      ["schedule", "process", "status"].includes(options.mode)
    ) {
      console.log(
        `Warning: Checkout reference argument only works in "status", "schedule", or "process" mode, but current mode is "${options.mode}"`
      );
    }
    getCachedParsedProgramArgs["cache"] = { options, remaining };
  }
  return {
    options,
    remaining,
  };
}
