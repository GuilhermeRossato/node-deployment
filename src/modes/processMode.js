import fs from "fs";
import path from "path";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import sleep from "../utils/sleep.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { spawnManagerProcess } from "../process/spawnManagerProcess.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { executeProcessPredictably } from "../process/executeProcessPredictably.js";
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
  const oldInstancePath = path.resolve(options.dir, process.env.OLD_INSTANCE_FOLDER_PATH);
  const prevInstancePath = path.resolve(options.dir, process.env.PREV_INSTANCE_FOLDER_PATH);
  const currInstancePath = path.resolve(options.dir, process.env.CURR_INSTANCE_FOLDER_PATH);
  const nextInstancePath = path.resolve(options.dir, process.env.NEXT_INSTANCE_FOLDER_PATH);
  const deploymentPath = path.resolve(options.dir, process.env.DEPLOYMENT_FOLDER_NAME);
  await waitForUniqueProcessor(deploymentPath, nextInstancePath);
  const execPurgeRes = await execPurge(oldInstancePath, prevInstancePath, currInstancePath, nextInstancePath);
  console.log(`execPurgeRes`, execPurgeRes);
  const execCheckoutRes = await execCheckout(options.dir, nextInstancePath, options.ref);
  console.log(`execCheckoutRes`, execCheckoutRes);

  const filesToCopy = (process.env.PIPELINE_STEP_COPY ?? "data,.env,node_modules,build").split(",");
  const execCopyRes = await execCopy(options.dir, nextInstancePath, filesToCopy);
  console.log(`execCopyRes`, execCopyRes);
  if (process.env.PIPELINE_STEP_INSTALL) {
    const execInstakk = await execInstall(options.dir, nextInstancePath, process.env.PIPELINE_STEP_INSTALL);
    console.log(`execInstakk`, execInstakk);
  }
  for (const cmd of [
    process.env.PIPELINE_STEP_INSTALL,
    process.env.PIPELINE_STEP_PREBUILD,
    process.env.PIPELINE_STEP_BUILD,
    process.env.PIPELINE_STEP_TEST,
  ]) {
    if (!cmd || cmd === "false") {
      continue;
    }
    const execRes = await execScript(nextInstancePath, cmd);
    console.log(`execRes`, cmd, execRes);
  }
  if (!options.shutdown && process.env.PIPELINE_STEP_START) {
    console.log(`Sending project server replacement request`);
    const r = await execReplaceProjectServer(options.debug, options.sync);
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
      await fs.promises.mkdir(nextInstancePath, { recursive: true });
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
  const old = (await checkPathStatus(oldInstancePath)).type.dir;
  const prev = (await checkPathStatus(prevInstancePath)).type.dir;
  const curr = (await checkPathStatus(currInstancePath)).type.dir;
  const next = (await checkPathStatus(nextInstancePath)).type.dir;

  if (old && prev) {
    debugProcess && console.log("Removing old instance path", { oldInstancePath });
    const result = await executeProcessPredictably(`rm -rf "${oldInstancePath}"`, path.dirname(oldInstancePath), {
      timeout: 10_000,
    });
    console.log(result);
  }

  if (prev) {
    debugProcess && console.log("Moving previous instance path", { prevInstancePath });
    const result = await executeProcessPredictably(
      `mv -rf "${prevInstancePath}" "${oldInstancePath}"`,
      path.dirname(prevInstancePath),
      { timeout: 10_000 }
    );
    console.log(result);
  }

  if (curr) {
    debugProcess && console.log("Copying instance path", { currInstancePath });
    const result = await executeProcessPredictably(
      `cp -rf "${currInstancePath}" "${prevInstancePath}"`,
      path.dirname(currInstancePath),
      { timeout: 10_000 }
    );
    console.log(result);
  }

  if (next) {
    return;
  }
  debugProcess && console.log("Removing new production folder", { nextInstancePath });
  // Remove new production folder
  const result = await executeProcessPredictably(`rm -rf "${nextInstancePath}"`, path.dirname(nextInstancePath), {
    timeout: 10_000,
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

async function execCheckout(repositoryPath, nextInstancePath, ref) {
  debugProcess && console.log("Executing checkout", { nextInstancePath });
  {
    const stat = await asyncTryCatchNull(fs.promises.stat(nextInstancePath));
    if (!stat) {
      // Create new production folder
      const result = await executeProcessPredictably(`mkdir "${nextInstancePath}"`, path.dirname(nextInstancePath), {
        timeout: 10_000,
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
    const refStr = ref && ref.startsWith("refs") ? ` --branch ${ref}` : ref && ref.length > 6 ? ` --detach ${ref}` : "";
    // Checkout
    const result = await executeProcessPredictably(
      `git --work-tree="${nextInstancePath}" checkout -f`,
      repositoryPath,
      { timeout: 10_000 }
    );
    if (result.error || result.exit !== 0) {
      throw new Error(
        `Failed to checkout to new production folder: ${JSON.stringify({
          result,
        })}`
      );
    }
  }
}

async function execCopy(repositoryPath, nextInstancePath, files = ["data", ".env", "node_modules", "build"]) {
  if (!(await checkPathStatus(repositoryPath)).type.dir) {
    console.log("Skipping copy because instance folder was not found at", JSON.stringify(repositoryPath));
    return;
  }
  console.log("Executing copy");
  for (const file of files) {
    const source = path.resolve(repositoryPath, file);
    const s = await asyncTryCatchNull(fs.promises.stat(source));
    if (!(s instanceof fs.Stats)) {
      console.log("Skipped copy of not found:", file);
      continue;
    }
    if (s.isDirectory()) {
      console.log("Copying folder", file, "...");
    } else if (s.isFile()) {
      console.log("Copying file", file, "...");
    }
    const target = path.resolve(nextInstancePath, file);
    const t = await asyncTryCatchNull(fs.promises.stat(target));
    if (s.isFile() && t) {
      console.log("Removing existing target before coping:", file);
      const result = await executeProcessPredictably(`rm -rf "${target}"`, path.dirname(nextInstancePath), {
        timeout: 10_000,
      });
      if (result.error || result.exit !== 0) {
        throw new Error(`Failed to remove existing copy target: ${JSON.stringify({ result })}`);
      }
    }
    const result = await executeProcessPredictably(`cp -r "${source}" "${target}"`, repositoryPath, {
      timeout: 10_000,
    });
    console.log({ result });
  }
}

async function execInstall(repositoryPath, nextInstancePath, cmd = "") {
  console.log("Executing install");
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
  const result = await executeProcessPredictably(cmd, nextInstancePath, {
    timeout: 10_000,
  });
  if (result.error || result.exit !== 0) {
    throw new Error(
      `Failed to install dependencies with "${cmd}": ${JSON.stringify({
        result,
      })}`
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

async function execReplaceProjectServer(debug, sync) {
  await executeWrappedSideEffect("Send upgrade request to manager server", async () => {
    let res = await sendInternalRequest("manager", "upgrade");
    if (res.error && res.stage === "network") {
      console.log(`Upgrade request to manager failed (${res.stage})`);
      await spawnManagerProcess(debug, !sync);
      res = await sendInternalRequest("manager", "upgrade");
    }

    console.log("Response", res);
  });
}
