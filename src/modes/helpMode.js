import path from "node:path";

/**
 * @param {import("../getProgramArgs.js").Options} options 
 */
export async function initHelp(options) {
  console.log("Node Deployment Manager Program");
  console.log("");
  const debug = options.debug;
  if (debug) {
    console.log("Program arguments:", process.argv.slice(2));
    console.log("Program working directory:", process.cwd());
    console.log("");
  }
  console.log(
    "\tContinuous Deployment Manager for Self-Hosted Node.js projects. This program processes the deployment cycle of projects stored in git repositores and its instance processes"
  );
  console.log("");
  console.log("Usage:");
  console.log("");
  console.log(
    `\t${path.basename(process.argv[1])} [mode] [...flags] [project-path]`
  );
  console.log("");
  console.log(" Modes:");
  const modeDescRec = {
      "--help / -h": "Display help",
      "--status": "Request the current status from the manager process and display it",
      "--logs": "Print the latest logs and stream them continuously as they are generated",
      "--start / --restart": "Start or restart the instance manager process and display its status",
      "--shutdown": "Stop the instance manager process from executing",
      "--setup": "Initialize a directory or a repository with this program",
      "--config": "Configure a repository and update its settings interactively",
      "--schedule": "Schedules an asyncronous execution of the deployment (in the background)",
      "--schedule <hash>": "Schedules the deployment at a specific commit",
      "--schedule <ref>": "Schedules the deployment at a specific reference or branch",
      "--deploy": "Execute the deployment steps syncronously at the current project version",
      "--deploy <hash>": "Execute the deployment at a specific commit",
      "--deploy <rev>": "Execute a deployment pipeline at a specific branch reference",
      "--manager": "Run this program to manage the project instance synchronously",
  };
  const modeDescs = Object.entries(modeDescRec);
  const flagDescs = [
    ["--debug / -d", "Enable verbose mode of the deployment manager"],
    ["--yes / -y", "Assume yes to all interactive user confirmations"],
    ["--dry-run / --dry", "Simulate execution by not writing files, causing no side-effects"],
    ["--sync / --wait", "Execute the deployment pipelines syncronously when in schedule mode"],
  ];
  const pad =
    Math.max(...[...modeDescs, ...flagDescs].map((a) => a[0].length)) + 2;
  for (const k of modeDescs) {
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  console.log("");
  console.log(" Flags:");
  console.log("");
  for (const k of flagDescs) {
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  console.log("");
  console.log("For more information visit this project's repository:");
  console.log("");
  console.log("\thttps://github.com/GuilhermeRossato/node-deployment");
  console.log("");
}
