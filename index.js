import path from "node:path";
import { loadEnvSync } from "./src/utils/loadEnvSync.js";
import attachToConsole from "./src/logs/attachToConsole.js";
import { getParsedProgramArgs, getInitForMode } from "./src/lib/getProgramArgs.js";
import { checkPathStatusSync } from "./src/utils/checkPathStatus.js";

loadEnvSync([process.cwd()], process.env);

const parsed = getParsedProgramArgs();

if (parsed.sync && parsed.mode !== "schedule") {
  console.log(`Warning: Syncronous flag argument only works in "schedule" mode, but current mode is "${parsed.mode}"`);
}

if (parsed.ref && !["schedule", "process"].includes(parsed.mode)) {
  console.log(
    `Warning: The reference argument is ignored in the current program mode (got "${parsed.mode}" and expected "schedule" or "processor")`
  );
}

const persistLogs = !["help", "logs", "runtime"].includes(parsed.options.mode);
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

let valid = true;
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
