import fs from "fs";
import path from "path";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import { executeCommandPredictably } from "../lib/executeCommandPredictably.js";
import asyncTryCatchNull from "../lib/asyncTryCatchNull.js";
import sleep from "../lib/sleep.js";

const hasStartArg = process.argv.includes("--start");
const hasRestartArg = process.argv.includes("--restart");
const hasShutdownArg = process.argv.includes("--shutdown");

const debugProcess = true;

export async function initProcessor() {
  if (hasShutdownArg || hasRestartArg || hasStartArg) {
    console.log(
      hasRestartArg ? "Restarting manager server" : "Terminating manager server"
    );
    const result = await sendInternalRequest("target", "shutdown", {});
    console.log(result);
  }
  const execPurgeRes = await execPurge();
  console.log(`execCheckout`, execPurgeRes);
  const execCheckoutRes = await execCheckout();
  console.log(`execCopy`, execCheckoutRes);
  const execCopyRes = await execCopy();
  console.log(`execInstall`, execCopyRes);
  const execInstallRes = await execInstall();
  const execBuildRes = await execScript("build");
  if (!hasShutdownArg || hasRestartArg) {
    console.log(`Sending project server replacement request`);
    const r = execReplaceProjectServer();
    console.log(`execReplace`, r);
  }
  console.log(`Processor finished`);
}

const newProductionFolder = "new-instance";
const productionFolder = "instance";
const projectRepositoryFolderPath = ".";

async function execPurge() {
  debugProcess && console.log("Executing purge", { newProductionFolder });
  const stat = await asyncTryCatchNull(fs.promises.stat(newProductionFolder));
  if (!stat) {
    debugProcess &&
      console.log("Skipped purge because new production folder does not exist");
    return;
  }
  // Remove new production folder
  const result = await executeCommandPredictably(
    `rm -rf "${newProductionFolder}"`,
    path.dirname(newProductionFolder),
    10_000
  );
  debugProcess && console.log("Removal of new production folder:", result);

  const newProdStat = await asyncTryCatchNull(
    fs.promises.stat(newProductionFolder)
  );
  if (result.error || result.exitCode !== 0) {
    if (newProdStat) {
      const list = await asyncTryCatchNull(
        fs.promises.readdir(newProductionFolder)
      );
      if (!(list instanceof Array) || list.length !== 0) {
        throw new Error(
          `Failed to remove new production folder: ${JSON.stringify({
            result,
          })}`
        );
      } else {
        debugProcess &&
          console.log(
            "Removal of new production folder failed but it is empty"
          );
      }
    } else {
      debugProcess &&
        console.log(
          "Removal of new production folder failed but it does not exist"
        );
    }
  }
  // Check
  for (let i = 0; i < 5; i++) {
    await sleep(50);
    const stat = await asyncTryCatchNull(fs.promises.stat(newProductionFolder));
    if (!stat) {
      continue;
    }
    const list = await asyncTryCatchNull(
      fs.promises.readdir(newProductionFolder)
    );
    if (!(list instanceof Array) || list.length === 0) {
      continue;
    }
    throw new Error("Purge failed");
  }
  return true;
}

async function execCheckout() {
  debugProcess &&
    console.log("Executing checkout", { projectRepositoryFolderPath });
  {
    const stat = await asyncTryCatchNull(fs.promises.stat(newProductionFolder));
    if (!stat) {
      // Create new production folder
      const result = await executeCommandPredictably(
        `mkdir "${newProductionFolder}"`,
        path.dirname(newProductionFolder),
        10_000
      );
      if (result.error || result.exitCode !== 0) {
        throw new Error(
          `Failed to create new production folder: ${JSON.stringify({
            result,
          })}`
        );
      }
    }
  }
  {
    // Checkout
    const result = await executeCommandPredictably(
      `git --work-tree="${newProductionFolder}" checkout -f`,
      projectRepositoryFolderPath,
      10_000
    );
    if (result.error || result.exitCode !== 0) {
      throw new Error(
        `Failed to checkout to new production folder: ${JSON.stringify({
          result,
        })}`
      );
    }
  }
}

async function execCopy() {
  console.log("Executing copy");
  const files = ["data", ".env", "node_modules", "build"];
  for (const file of files) {
    const source = path.resolve(productionFolder, file);
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
    const target = path.resolve(newProductionFolder, file);
    const t = await asyncTryCatchNull(fs.promises.stat(target));
    if (s.isFile() && t) {
      console.log("Removing existing target before copy for:", file);
      const result = await executeCommandPredictably(
        `rm -rf "${target}"`,
        path.dirname(newProductionFolder),
        10_000
      );
      if (result.error || result.exitCode !== 0) {
        throw new Error(
          `Failed to remove existing target: ${JSON.stringify({ result })}`
        );
      }
    }
    const result = await executeCommandPredictably(
      `cp -r "${source}" "${target}"`,
      newProductionFolder,
      10_000
    );
    console.log({ result });
  }
}

async function execInstall(isYarn = false) {
  console.log("Executing install");
  const files = [
    { name: "package.json", origin: null, target: null },
    { name: "package-lock.json", origin: null, target: null },
    { name: "yarn.lock", origin: null, target: null },
    { name: "node_modules", origin: null, target: null },
  ];
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i].name;
    files[i].origin = await asyncTryCatchNull(
      fs.promises.readFile(path.resolve(productionFolder, fileName))
    );
    files[i].target = await asyncTryCatchNull(
      fs.promises.readFile(path.resolve(newProductionFolder, fileName))
    );
  }
  debugProcess &&
    console.log(
      "Install files from production folder:",
      files.filter((f) => f.origin).map((f) => f.name)
    );
  debugProcess &&
    console.log(
      "Install files at new production folder:",
      files.filter((f) => f.target).map((f) => f.name)
    );
  const [pkg, pklock, yarnlock, nodemodules] = files;
  if (!pkg.target) {
    debugProcess &&
      console.log('Install skipped because "package.json" was not found');
    return;
  }
  if (
    pkg.origin === pkg.target &&
    pklock.origin &&
    pklock.target &&
    pklock.origin === pklock.target
  ) {
    debugProcess &&
      console.log(
        'Install skipped because both "package.json" and "package-lock.json" matched'
      );
    return;
  }
  if (
    pkg.origin === pkg.target &&
    yarnlock.origin &&
    yarnlock.target &&
    yarnlock.origin === yarnlock.target
  ) {
    debugProcess &&
      console.log(
        'Install skipped because both "package.json" and "yarn.lock" matched'
      );
    return;
  }

  const manager = isYarn ? "yarn" : "npm";
  const arg =
    isYarn && yarnlock.target
      ? "--frozen-lockfile"
      : isYarn
      ? ""
      : pklock.target
      ? "ci"
      : "install";
  const cmd = (manager + " " + arg).trim();

  debugProcess && console.log("Install command:", cmd);
  const result = await executeCommandPredictably(
    cmd,
    newProductionFolder,
    10_000
  );
  if (result.error || result.exitCode !== 0) {
    throw new Error(
      `Failed to install dependencies with "${cmd}": ${JSON.stringify({
        result,
      })}`
    );
  }
  const stat = await asyncTryCatchNull(
    fs.promises.readFile(path.resolve(newProductionFolder, "node_modules"))
  );
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

async function execScript(script = "build", isYarn = false, timeout = 10_000) {
  const prefix = isYarn ? `yarn run` : "npm run";
  const pkgText = await asyncTryCatchNull(
    fs.promises.readFile(path.resolve(newProductionFolder, "package.json"))
  );
  const pkg = typeof pkgText === "string" ? JSON.parse(pkgText) : null;
  const scriptRec = pkg ? pkg.scripts : null;
  if (!scriptRec || !scriptRec[script]) {
    throw new Error(
      `Could not find npm script "${script}" at "package.json" to execute at script record: ${JSON.stringify(
        scriptRec
      )}`
    );
  }
  const cmd = `${prefix} ${script}`;
  process.stdout.write(`\n`);
  const result = await executeCommandPredictably(
    cmd,
    newProductionFolder,
    timeout,
    (t) => process.stdout.write(t)
  );
  if (result.error || result.exitCode !== 0) {
    throw new Error(
      `Failed to execute "${cmd}": ${JSON.stringify({
        ...result,
        start: undefined,
      })}`
    );
  }
  debugProcess && console.log("Script was successfull");
}

async function execReplaceProjectServer() {
  const result = await sendInternalRequest("manager", "upgrade");
  console.log("Response", result);
}
