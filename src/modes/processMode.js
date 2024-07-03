import fs from "fs";
import path from "path";
import { sendInternalRequest } from "../lib/sendInternalRequest.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import sleep from "../utils/sleep.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { spawnManagerProcess } from "../process/spawnManagerProcess.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { executeProcessPredictably } from "../process/executeProcessPredictably.js";
import { executeGitCheckout } from "../lib/getRepoCommitData.js";
import { getInstancePathStatuses } from "../lib/getInstancePathStatuses.js";
import { executeGitProcessPredictably } from "../process/executeGitProcessPredictably.js";
const debugProcess = true;

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initProcessor(options) {
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
    const g = await checkPathStatus([currInstancePath, ".git"]);
    if (g && g.type.dir) {
      debugProcess && console.log("Removing .git folder from current instance at:", JSON.stringify(g.path));
      const result = await executeProcessPredictably(`rm -rf "${g.path}"`, path.dirname(currInstancePath), {
        timeout: 20_000,
        shell: true,
      });
      if (result.error || result.exit !== 0) {
        console.log("Failed while removing git folder at:", JSON.stringify(g.path));
      }
    }
    debugProcess && console.log("Copying current instance files to", prevInstancePath);
    await sleep(500);
    const result = await executeProcessPredictably(
      `cp -rf "${currInstancePath}" "${prevInstancePath}"`,
      path.dirname(currInstancePath),
      { timeout: 20_000, shell: true }
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

export async function execProcCheckout(repositoryPath, nextInstancePath, ref) {
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
      "Files at current instance folder:",
      files.filter((f) => f.source).map((f) => f.name)
    );
  debugProcess &&
    console.log(
      "Files at upcoming instance folder:",
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
    output: function installOut(d) {
      if (d.endsWith("\n")) {
        d = d.substring(0, d.length - 1);
      }
      console.log(d);
    },
  });
  const depPath = path.resolve(nextInstancePath, "node_modules");
  process.stdout.write("\n");
  if (result.error instanceof Error && fs.existsSync(depPath)) {
    console.log(`Failed for the first time while installing dependencies: ${JSON.stringify(result.error.stack)}`);

    console.log("Removing existing node_modules folder at", JSON.stringify(depPath));
    const res = await executeProcessPredictably(`rm -rf "${depPath}"`, nextInstancePath, {
      timeout: 10_000,
      shell: true,
    });
    if (res.error instanceof Error) {
      throw new Error(
        `Failed with error while removing existing node_modules with "${cmd}":\n${JSON.stringify(res.error.stack)}`
      );
    }
    if (res.error) {
      throw new Error(`Failed with while removing existing node_modules with "${cmd}":\n${JSON.stringify(res)}`);
    }
  }
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
  const stat = await asyncTryCatchNull(fs.promises.readFile(depPath));
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
