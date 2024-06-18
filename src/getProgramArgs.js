import { initManager } from "./modes/managerMode.js";
import { initScheduler } from "./modes/scheduleMode.js";
import { initConfig } from "./modes/configMode.js";
import { initStatus } from "./modes/statusMode.js";
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

const programInitHandlers = {
  help: initHelp,
  status: initStatus,
  setup: initConfig,
  schedule: initScheduler,
  process: initProcessor,
  manager: initManager,
};

export function getProgramInitHandlerFromMode(mode = "") {
  return programInitHandlers[mode || "setup"];
}

export function getProgramArgs(args = process.argv.slice(2)) {
  /**
   * @type {Options}
   */
  const options = {
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
  const indexes = {
    debug: -1,
    yes: -1,
    dry: -1,
    sync: -1,
    start: -1,
    restart: -1,
    shutdown: -1,
    mode: -1,
    ref: -1,
    dir: -1,
  };
  const remaining = args.filter((arg, i) => {
    const isPath =
      arg.startsWith(".") ||
      arg.includes("/") ||
      arg.includes("\\") ||
      arg.length > 9;
    if (indexes.dir === -1 && isPath) {
      indexes.dir = i;
      options.dir = arg;
      return;
    }
    let flag =
      arg.startsWith("-") && arg.length < 11
        ? `-${arg.replace(/\W/g, "").toLowerCase().trim()}`
        : "";
    if (
      indexes.debug === -1 &&
      ["-debug", "-d", "-verbose", "-v"].includes(flag)
    ) {
      indexes.debug = i;
      options.debug = true;
      return;
    }
    if (indexes.yes === -1 && ["-yes", "-ye", "-ya", "-y"].includes(flag)) {
      indexes.yes = i;
      options.yes = true;
      return;
    }
    if (indexes.sync === -1 && ["-sync", "-wait"].includes(flag)) {
      indexes.sync = i;
      options.sync = true;
      return;
    }
    if (
      indexes.dry === -1 &&
      ["-dry", "-dry-run", "-dryrun", "-simulate", "-sim"].includes(flag)
    ) {
      indexes.dry = i;
      options.dry = true;
      return;
    }
    if (
      indexes.start === -1 &&
      ["-start", "-spawn", "-on"].includes(flag)
    ) {
      indexes.start = i;
      options.start = true;
      return;
    }
    if (
      indexes.restart === -1 &&
      ["-restart", "-reset", "-reload"].includes(flag)
    ) {
      indexes.restart = i;
      options.restart = true;
      return;
    }
    if (
      indexes.shutdown === -1 &&
      ["-shutdown", "-disable", "-off"].includes(flag)
    ) {
      indexes.shutdown = i;
      options.shutdown = true;
      return;
    }
    if (indexes.mode === -1) {
      const names = Object.keys(programInitHandlers);
      if (flag === "-logs") {
        flag = "-status";
      } else if (flag === "-config") {
        flag = "-setup";
      }
      const index = names
        .map((k) => k.substring(0, 3))
        .indexOf(flag.substring(1, 4));
      if (index !== -1) {
        indexes.modes = i;
        options.mode = names[index];
        return;
      }
    }
    if (
      indexes.ref === -1 &&
      i > 0 &&
      i - 1 === indexes.mode &&
      (arg.startsWith("refs/") ||
        ([7, 8, 40].includes(arg.length) && /^[0-9a-fA-F]{40}$/.test(arg)))
    ) {
      indexes.ref = i;
      options.ref = arg;
      return;
    }
    if (indexes.dir === -1) {
      indexes.dir = i;
      options.dir = arg;
      return;
    }
    return true;
  });
  if (!options.mode) {
    options.mode = "setup";
  }
  return {
    options,
    indexes,
    remaining,
  };
}
