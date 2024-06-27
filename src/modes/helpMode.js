import path from "node:path";
import sleep from "../utils/sleep.js";

const modeDescRec = {
  "--help / -h": "Display this help text",
  "--setup": "Initialize and setup a project for automatic deployment",
  "--config": "Change settings and configure a repository interactively",
  "--status / -s": "Retrieve status information from the manager process",
  "--logs / -l": "Print and stream all logs continuously",
  "--instance / --app": "Print and stream logs from the project instance process",
  "--start / --restart": "Start or restart the manager process and display its status",
  "--shutdown": "Stop the project process and the instance manager process",
  "--schedule": "Manually schedule the asyncronous execution of the deployment pipeline",
  "--schedule <commit>": "Schedules deployment of a specific version of the project",
  "--schedule <ref>": "Schedules deployment specifying the project version by a reference",
  "--upgrade <path>": "Fetch the deployment script source and write to a target file",
  "--process": "Execute the deployment syncronously at the current project version",
  "--process <commit>": "Execute the deployment at a specific commit",
  "--process <rev>": "Execute a deployment pipeline at a specific branch reference",
  "--manager": "Run this program to manage the project instance synchronously",
};
const modeDescs = Object.entries(modeDescRec);
const flagDescs = [
  ["--debug / --verbose / -d", "Enable verbose mode (prints more logs)"],
  ["--force / --yes / -y", "Force confirmations, automatically assuming yes "],
  ["--dry-run / --dry", "Simulate execution by not writing files and causing no side-effects"],
  ["--sync / --wait", "Execute child processes syncronously"],
];
const pad = Math.max(...[...modeDescs, ...flagDescs].map((a) => a[0].length)) + 2;

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initHelp(options) {
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
  const limit = options.debug ? modeDescs.length : 8;
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
