import path from "node:path";

export async function initHelp() {
  console.log("Node Deployment Manager Program");
  console.log("");
  const debug = process.argv.includes("--debug");
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
    `\t${path.basename(process.argv[1])} [mode] [flags] [project-path]`
  );
  console.log("");
  console.log(" Modes:");
  const smallModeDescs = {
      "--help / -h": "Display help",
      "--status / --logs": "Show project status and stream logs",
      "--setup / --config": "Initialize or update the config of a project",
      "--schedule": "Schedule async deployment execution (at background)",
      "--schedule <hash>": "Schedule deployment at a specific commit",
      "--deploy": "Execute synchronous deployment at current version",
      "--deploy <hash>": "Execute synchronous deployment from specific commit",
      "--manager": "Run as daemon to manage project synchronously"
  };
  const fullModeDescs = {
      "--help": "Display this help text",
      "--status / --logs": "Display the current status of a project and stream logs",
      "--setup": "Initializes a new project and its configuration interactively",
      "--config": "Configure a project's settings interactively",
      "--schedule": "Schedules an async execution of the deployment pipeline at its latest version",
      "--schedule <hash>": "Schedules deployment as the project was in a specifiy commit (by hash)",
      "--deploy": "Execute the deployment syncronously at the current project version",
      "--deploy <hash>": "Execute the deployment syncronously as it was in a specifiy commit (by hash)",
      "--manager": "Run this program as a daemon process, managing the project's process syncronously"
  };
  const modeDescs = Object.entries(debug ? fullModeDescs : smallModeDescs);
  const flagDescs = [
    ["--debug / -d", "Enable verbose mode of the deployment manager"],
    ["--yes / -y", "Assume yes to interactive user confirmations"],
    ["--dry-run / --dry", "Simulate execution without side-effects nor writes"],
  ];
  const pad =
    Math.max(...[...modeDescs, ...flagDescs].map((a) => a[0].length)) + 2;
  for (const k of modeDescs) {
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  console.log("");
  console.log(" Flags:");
  console.log("");
  for (const k of modeDescs) {
    console.log(`\t${k[0].padEnd(pad)}${k[1]}`);
  }
  console.log("");
  console.log("For more information visit this project's repository:");
  console.log("");
  console.log("\thttps://github.com/GuilhermeRossato/node-deployment");
  console.log("");
}
