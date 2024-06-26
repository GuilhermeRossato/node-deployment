import fs from "node:fs";
import path from "node:path";
import { canExecuteSideEffects, executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { executeProcessPredictably } from "../process/executeProcessPredictably.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import { spawnManagerProcess } from "../process/spawnManagerProcess.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import fetchProjectReleaseFileSource from "../lib/fetchProjectReleaseFileSource.js";
import getDateTimeString from "../utils/getDateTimeString.js";
import { getRepoCommitData } from "../lib/getRepoCommitData.js";
import { getIntervalString } from "../utils/getIntervalString.js";
import sleep from "../utils/sleep.js";

let canSkipConfirm = false;

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initConfig(options) {
  if (!process.env.DEPLOYMENT_FOLDER_NAME) {
    process.env.DEPLOYMENT_FOLDER_NAME = "deployment";
  }
  if (!process.env.LOG_FOLDER_NAME) {
    process.env.LOG_FOLDER_NAME = "deployment";
  }
  canSkipConfirm = options.force;
  const obj = await interGetRepositoryPath(options);
  const targetPath = obj && obj.path && typeof obj.path === "string" ? obj.path : process.cwd();
  let status = await checkPathStatus(targetPath);
  if (!status.type.dir && !status.type.file && obj.confirmCreate !== true) {
    console.log(
      `Specified path does not exist ("${
        status.parent ? path.basename(targetPath) : path.basename(path.dirname(targetPath))
      }" ${status.type.dir ? "at" : "was not found at"} "${
        status.parent ? path.dirname(targetPath) : path.dirname(path.dirname(targetPath))
      }")`
    );
    const conf = await intConfirm(`Create and initialize a repository at "${path.basename(targetPath)}"?`);
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.confirmCreate = true;
    obj.confirmInit = true;
  }
  if (status.type.dir && (!status.type.bare || !status.type.proj) && obj.confirmInit !== true) {
    console.log(
      `Specified path exist ("${status.parent ? path.basename(targetPath) : path.basename(path.dirname(targetPath))}" ${
        status.type.dir ? "at" : "was not found at"
      } "${status.parent ? path.dirname(targetPath) : path.dirname(path.dirname(targetPath))}")`
    );
    const conf = await intConfirm(`Initialize a repository at "${path.basename(targetPath)}"?`);
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.confirmInit = true;
  }
  let initialized = false;
  if (!status.type.proj) {
    console.log("Initializing project at setup");
    await initializeGitRepositoryProject(targetPath, options.force);
    initialized = true;
    status = await checkPathStatus(targetPath);
  }
  console.log("Verifying hash...");
  const commitData = await getRepoCommitData(targetPath);
  options.debug &&
    console.log(
      "[debug] Hash result:",
      commitData,
      `(${getIntervalString(new Date().getTime() - commitData.date.getTime())} ago)`
    );
  if (commitData.error) {
    console.log(
      `Last commit check failed: ${
        commitData.error instanceof Error ? commitData.error.stack : JSON.stringify(commitData.error)
      }`
    );
    throw new Error("Failed while reading latest repository commit data");
  }
  options.debug && console.log("Requesting manager process status...");
  let res;
  let offline = initialized;
  if (!offline) {
    res = await sendInternalRequest("manager", "status");
    offline = res.error && res.stage === "network";
    if (offline) {
      console.log(`Status request to manager failed to connect (${res.stage})`);
    }
  }
  if (offline) {
    const detached = !options.sync;
    console.log("Attempting to spawn manager process", detached ? "detached" : "attached");
    await spawnManagerProcess(options.debug, detached);
    await sleep(500);
  }
  if (offline) {
    options.debug && console.log("Requesting manager process status...");
    offline = res.error && res.stage === "network";
  }
  if (offline && options.mode === "setup") {
  }
  console.log("Manager process response:");
  console.log(res);
  intPause();
}

function isFileFromBareRepo(f) {
  if (f.endsWith(".log") || f.endsWith(".pid")) {
    return true;
  }
  if (f === (process.env.DEPLOYMENT_FOLDER_NAME || "deployment")) {
    return true;
  }
  if (f === (process.env.LOG_FOLDER_NAME || "deployment")) {
    return true;
  }
  if (
    [
      "branches",
      "config",
      "deployment",
      "description",
      "HEAD",
      "hooks",
      "index",
      "info",
      "objects",
      "refs",
      "FETCH_HEAD",
      "COMMIT_EDITMSG",
      "ORIG_HEAD",
    ].includes(f)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {import("../utils/checkPathStatus.js").PathStatus} status
 */
async function interVerifyTargetCandidate(status, isArg = false) {
  if (!status.parent) {
    console.log(`Specified path does not exist (Parent not found at "${path.dirname(path.resolve(status.path))}")`);
    const conf = await intConfirm(`Create and initialize a repository at "${path.basename(status.path)}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: true,
      origin: "no-parent",
    };
  }
  if (status.parent && !status.type.file && !status.type.dir) {
    const parent = await checkPathStatus(status.parent);

    // Find file name match
    if (parent.type.dir && parent.children instanceof Array) {
      const names = parent.children.filter(
        status.name.startsWith("*")
          ? (name) => name.endsWith(status.name.substring(1))
          : (name) =>
              name.startsWith(
                status.name.endsWith("*") ? status.name.substring(0, status.name.length - 1) : status.name
              )
      );
      if (!names.length && !status.name.endsWith(".git")) {
        names.push(`${status.name}.git`);
      }
      const checks = await Promise.all(names.map((name) => checkPathStatus([parent.path, name])));
      const match =
        checks.find((p) => p.type.proj) || checks.find((p) => p.type.bare) || checks.find((p) => p.type.dir);
      if (match) {
        console.log(`Specified path does not exist but "${match.name}" is a close match to "${status.name}"`);
        const conf = await intConfirm(
          `Select the existing ${
            match.type.bare
              ? "bare repository"
              : match.children.length === 0
              ? "empty folder"
              : `folder with ${match.children.length} files`
          } at "${match.path}"?`
        );
        if (conf) {
          return {
            path: status.path,
            confirmCreate: false,
            origin: "match",
          };
        }
      }
    }

    if (isArg) {
      console.log(
        `Specified path does not exist ("${status.name}" was not found at "${path.dirname(path.resolve(status.path))}")`
      );
    }
    const conf = await intConfirm(`Create and initialize "${path.basename(status.path)}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: true,
      confirmInit: true,
      origin: "not-found",
    };
  }
  if (status.type.proj) {
    console.log(`Specified project at "${status.path}"`);
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: false,
      origin: "target",
    };
  }
  if (status.type.bare) {
    console.log(`Specified unitialized repository at "${status.path}"`);
    const rname = status.name === ".git" ? path.basename(status.parent) : status.name;
    const conf = await intConfirm(`Initialize the repository "${rname}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: isArg ? "uninit-options" : "uninit",
    };
  }
  if (status.type.file) {
    console.log(
      `Specified path is not a folder ("${status.name}" is a file of "${path.dirname(path.resolve(status.parent))}")`
    );
    return;
  }
  if (status.type.dir && status.children.length === 0) {
    console.log(`Specified an empty folder ("${status.name}" at "${path.dirname(path.resolve(status.parent))}")`);
    const conf = await intConfirm(`Initialize a new git bare repository at "${status.name}"?`);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: "target",
    };
  }
  if (
    status.type.dir &&
    !status.children.includes("hooks") &&
    !status.children.includes("refs") &&
    !status.children.includes("config") &&
    status.children.includes(".git")
  ) {
    const s = await checkPathStatus([status.path, ".git"]);
    if (
      s.type.dir &&
      s.children.includes("hooks") &&
      s.children.includes("refs") &&
      s.children.includes("config") &&
      !s.children.includes(".git")
    ) {
      if (s.type.proj) {
        console.log(`Specified project at "${s.path}"`);
        return {
          path: s.path,
          confirmCreate: false,
          confirmInit: false,
          origin: "indirect",
        };
      } else if (s.type.bare) {
        console.log(`Specified unitialized git repository at "${s.path}"`);
        const rname = s.name === ".git" ? path.basename(s.parent) : s.name;
        const conf = await intConfirm(`Initialize the repository "${rname}"?`);
        if (!conf) {
          return;
        }
        return {
          path: s.path,
          confirmCreate: false,
          confirmInit: true,
          origin: "uninit",
        };
      }
    }
  }
  if (status.type.dir) {
    let message = "";
    const extras = status.children.filter((f) => !isFileFromBareRepo(f));
    if (extras.length <= 3) {
      console.log(`Specified folder "${status.name}" contains`, status.children.length, `children`);
      if (extras.length !== 0) {
        console.log(`Ignoring some unexpected files inside: ${extras.join(", ")}`);
      }
      message = `Initialize a new git bare repository at "${status.name}"?`;
    } else if (extras.length > 3) {
      console.log(
        `Specified folder "${status.name}" contains`,
        extras.length,
        "unexpected children out of",
        status.children.length
      );
      let line = `${extras.join(", ")}`;
      const limit = (process.stdout.columns || 80) - 8 - 1;
      if (line.length >= limit) {
        line = `${line.substring(0, limit - 5)}, ...`;
      }
      process.stdout.write(`\n`);
      process.stdout.write(`Path :  ${status.path}\n`);
      process.stdout.write(`Files:  ${line}\n`);
      process.stdout.write(`\n`);
      message = "Found unexpected contents. Are you sure you want to select this folder?";
    }
    const conf = await intConfirm(message);
    if (!conf) {
      return;
    }
    return {
      path: status.path,
      confirmCreate: false,
      confirmInit: true,
      origin: extras.length <= 3 ? "existing" : "existing-extra",
    };
  }
  throw new Error("Unhandled");
}

async function interGetRepositoryPath(options) {
  const result = {
    path: "",
    origin: "",
    confirmCreate: false,
    confirmInit: false,
  };
  let cand = null;
  const deployName = process.env.DEPLOYMENT_FOLDER_NAME || "deployment";
  if (options.dir) {
    cand = await checkPathStatus(options.dir);
    console.log(
      cand.type.proj
        ? "Project path"
        : cand.type.dir
        ? "Folder path"
        : cand.type.file
        ? "File path"
        : "Inexistant path",
      "from parameter:",
      cand.path
    );
    const v = await interVerifyTargetCandidate(cand, true);
    if (v?.path) {
      return v;
    }
  }
  cand = await checkPathStatus(process.cwd());
  if (cand.type.dir && (cand.type.bare || cand.type.proj)) {
    console.log("Selecting target from current folder as bare or proj:", cand.path);
    const v = await interVerifyTargetCandidate(cand, true);
    if (v?.path) {
      return v;
    }
  }
  if (cand.type.dir && !cand.children.includes("hooks") && cand.name === deployName) {
    cand = await checkPathStatus(cand.parent);
    if (
      cand.type.dir &&
      cand.children.includes("hooks") &&
      cand.children.includes("refs") &&
      cand.children.includes("config") &&
      !cand.children.includes(".git")
    ) {
      console.log("Selecting target from current folder as deployment folder:", cand.path);
      return await interVerifyTargetCandidate(cand, false);
    }
  }
  result.path = await intValid("Provide the git bare repository path", async (text) => {
    const res = await checkPathStatus(text.trim());
    const ver = await interVerifyTargetCandidate(res, false);
    if (ver?.path) {
      result.confirmCreate = ver.confirmCreate;
      result.confirmInit = ver.confirmInit;
      return ver.path;
    }
  });
  result.origin = "input";
  return result;
}

async function initializeGitRepositoryProject(targetPath, forceUpdate = false) {
  const status = await checkPathStatus(targetPath);
  console.log(
    `Initializing ${status.type.bare ? "the" : status.type.dir ? "an existing" : "a new"} git repository named`,
    JSON.stringify(path.basename(targetPath)),
    "inside a folder named",
    JSON.stringify(path.basename(path.dirname(targetPath)))
  );
  if (status.type.bare) {
    console.log(
      "Target git repository exists as a bare git repository",
      status.children.length === 0 ? "and is empty" : `and has ${status.children.length} children`
    );
  } else if (status.type.dir) {
    console.log(
      "Target folder exists",
      status.children.length === 0 ? "and is empty" : `and has ${status.children.length} children`
    );
  } else {
    await executeWrappedSideEffect("Create repository directory", async () => {
      await fs.promises.mkdir(targetPath, { recursive: true });
    });
  }
  if (!status.type.bare) {
    await executeWrappedSideEffect(
      "Initialize repository",
      async () => {
        const result = await executeProcessPredictably("git init --bare", targetPath, { timeout: 2500 });
        if (result.exit !== 0 || result.error) {
          console.log("Git init failed with exit code", result.exit);
          console.log(result.output);
          throw new Error("Git init Failed");
        }
      },
      targetPath
    );
  }
  await initPostUpdateScript(targetPath);
  const deployFolderPath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME);
  const dep = await checkPathStatus(deployFolderPath);
  if (!dep.type.dir) {
    await executeWrappedSideEffect("Create deployment folder", async () => {
      await fs.promises.mkdir(deployFolderPath, { recursive: true });
      console.log("Created deployment folder at", deployFolderPath);
    });
  }
  const deployScriptPath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME, "node-deploy.cjs");
  const scr = await checkPathStatus(deployScriptPath);
  if (!scr.type.file || new Date().getTime() - scr.mtime > 15_000) {
    console.log("Checking the deployment script for the project");
    const candidates = await Promise.all(
      [
        deployScriptPath,
        "./node-deploy.cjs",
        process.argv[1],
        path.resolve(path.dirname(path.resolve(process.cwd(), process.argv[1])), "node-deploy.cjs"),
      ].map((p) => checkPathStatus(p))
    );
    const lastUpdate = Math.max(...candidates.map((s) => (s.type.file ? s.mtime : null)).filter((t) => t));
    const match = candidates.find((c) => c.mtime === lastUpdate);
    if (match) {
      console.log(
        "Last deployment script file:",
        JSON.stringify(match.path),
        "updated at",
        getDateTimeString(match.mtime)
      );
    }

    let response;
    try {
      response = await fetchProjectReleaseFileSource();
      console.log(
        "Remote deployment script date:",
        response ? getDateTimeString(response.updated) : "(failed to fetch)"
      );
    } catch (err) {
      console.log("Remote deployment script could not be loaded:", err.message);
    }
    const fromRemote = response ? response.updated.getTime() : 0;
    const fromLocal = match ? 0 : new Date(match.mtime).getTime();
    let buffer;
    if (forceUpdate || fromLocal === 0 || (fromRemote && fromLocal + 50 < fromRemote)) {
      if (response?.buffer) {
        console.log("Writing deployment script from published remote");
        buffer = response.buffer;
      } else if (match && match !== candidates[0]) {
        console.log("Writing deployment script from local file:", match.path);
        buffer = await fs.promises.readFile(match.path);
      } else {
        throw new Error("Could not find updated deployment script source");
      }
    } else if (candidates[0].type.file && candidates[0].mtime === lastUpdate) {
      console.log("Current deployment script is most recent and will not be updated");
    } else {
      console.log("Writing deployment script from", JSON.stringify(match.path));
      buffer = await fs.promises.readFile(match.path);
    }
    if (buffer) {
      await executeWrappedSideEffect("Add deployment script", async () => {
        await fs.promises.writeFile(deployScriptPath, buffer);
        console.log("Deployment script ready at", JSON.stringify(deployScriptPath));
      });
    }
  }
  await initializeConfigFile(targetPath);
  console.log(
    "Initialization of git repository finished for",
    JSON.stringify(path.basename(targetPath)),
    "at",
    JSON.stringify(path.dirname(targetPath))
  );
  const check = await checkPathStatus(targetPath);
  if (!check.type.proj && !canExecuteSideEffects()) {
    throw new Error("Failed initialization because target path is not a valid project after initializing");
  }
}

async function initializeConfigFile(targetPath) {
  const envPath = path.resolve(targetPath, process.env.DEPLOYMENT_FOLDER_NAME || "deployment", ".env");
  const cfg = await checkPathStatus(envPath);
  const text = cfg.type.file ? await fs.promises.readFile(envPath, "utf-8") : "";
  const pairs = text
    .split("\n")
    .map((f) => (f.includes("=") ? f.trim() : ""))
    .filter((f) => f.length)
    .map((a) => [a.substring(0, a.indexOf("=")), a.substring(a.indexOf("=") + 1)]);

  const names = [
    "LOG_FOLDER_NAME",
    "DEPLOYMENT_FOLDER_NAME",
    "OLD_INSTANCE_FOLDER_PATH",
    "PREV_INSTANCE_FOLDER_PATH",
    "CURR_INSTANCE_FOLDER_PATH",
    "NEXT_INSTANCE_FOLDER_PATH",
    "PIPELINE_STEP_COPY",
    "PIPELINE_STEP_INSTALL",
    "PIPELINE_STEP_PREBUILD",
    "PIPELINE_STEP_BUILD",
    "PIPELINE_STEP_TEST",
    "PIPELINE_STEP_START",
    ...pairs.map((p) => p[0]),
  ];
  const uniques = [...new Set(names)];
  const vars = uniques.map((name) => {
    const saved = (
      pairs
        .filter((p) => p[0] === name)
        .map((p) => p[1])
        .pop() || ""
    ).trim();
    const value = (process.env[name] || "").trim();
    return {
      name,
      value,
      saved,
      same: value === saved,
    };
  });
  const updates = vars.filter((f) => !f.same).map((a) => a.name);
  if (updates.length === 0) {
    return false;
  }
  if (!vars.map((v) => v.name).includes("DEPLOYMENT_SETUP_DATE_TIME")) {
    vars.push({
      name: "DEPLOYMENT_SETUP_DATE_TIME",
      value: new Date().toISOString(),
      saved: "",
      same: false,
    });
  }
  console.log(
    cfg.type.file ? "Existing" : "Missing",
    "env config file of",
    targetPath,
    "has",
    updates.length,
    "differences"
  );
  const lines = [];
  for (const { name, value } of vars) {
    lines.push(`${name}=${value}`);
  }
  const newText = lines.join("\n") + "\n";
  console.log("Writing", newText.length, "chars to project config file (from", text.length, "chars)");
  await executeWrappedSideEffect(`${cfg.type.file ? "Update" : "Create"} config file`, async () => {
    await fs.promises.writeFile(envPath, newText, "utf-8");
    console.log(
      `${cfg.type.file ? "Updated" : "Created"} deployment config file "${path.basename(envPath)}" inside`,
      JSON.stringify(path.dirname(envPath))
    );
  });
  return true;
}

async function initPostUpdateScript(targetPath) {
  console.log("Verifying post-update script");

  let s = await checkPathStatus(targetPath);
  if (s.type.dir && !s.children.includes("hooks") && !s.children.includes("refs") && s.children.includes(".git")) {
    const a = await checkPathStatus([targetPath, ".git"]);
    if (a.type.dir && a.children.includes("hooks") && a.children.includes("refs") && !a.children.includes(".git")) {
      targetPath = path.resolve(targetPath, ".git");
      s = a;
      console.log('Updated target repository path to ".git" folder');
    }
  }

  const updFilePath = path.resolve(targetPath, "hooks", "post-update");
  const updOriginal = await asyncTryCatchNull(fs.promises.readFile(updFilePath, "utf-8"));
  const updExists = typeof updOriginal === "string" && updOriginal.trim().length;

  let updSource = updExists ? updOriginal.trim() : "";
  if (!updSource.startsWith("#!")) {
    updSource = `#!/bin/bash\n${updSource}`;
  }
  if (!updSource.includes("--scheduler") && !updSource.includes("--processor")) {
    const line = `"${process.argv[0]}" ./${process.env.DEPLOYMENT_FOLDER_NAME}/node-deploy.cjs --scheduler $*`;
    updSource =
      updSource.substring(0, updSource.indexOf("\n") + 1) + line + updSource.substring(updSource.indexOf("\n") + 1);
  }
  const up = await checkPathStatus(updFilePath);
  if (!up.parent && !canExecuteSideEffects()) {
    throw new Error(`The post-update "hooks" folder was not found for "${updFilePath}"`);
  } else if (!up.parent) {
    console.log(`The post-update "hooks" folder was not found for "${updFilePath}"`);
  }
  if (!updExists || (updExists && updOriginal.trim() !== updSource.trim())) {
    console.log(updExists ? "Updating" : "Creating", "post-update hook");
    await executeWrappedSideEffect(
      "Create and enable post-update hook",
      async (updateFilePath) => {
        await fs.promises.writeFile(updateFilePath, updSource, "utf-8");
        console.log("Created git hook file");
        const result = await executeProcessPredictably(`chmod +x "${updateFilePath}"`, targetPath);
        if (result.exit !== 0 || result.error) {
          console.log("Updating execution permission of git hook failed with exit code", result.exit);
          console.log(result.output ? result.output : result);
          throw new Error("Updating execution permission of git hook failed");
        }
        console.log("Enabled git hook file");
      },
      updFilePath
    );
  }
}

function intPause() {
  if (!global["intResolve"]) {
    return;
  }
  global["intResolve"] = null;
  process.stdin.pause();
}
/**
 * Prompts the user with a message and waits for input
 * @param {string} subject - Message to display
 * @returns {Promise<string>}
 */
async function intQuery(subject = "") {
  if (!global["intResolve"]) {
    global["intResolve"] = () => {};
    process.stdin.on("data", (data) => global["intResolve"](data.toString("utf-8")));
  }
  if (typeof subject === "string") {
    console.log("User input", JSON.stringify(subject.substring(0, 32) + (subject.length > 32 ? "..." : "")));
    process.stdout.write(`\n`);
    process.stdout.write(`${subject} `);
  }
  while (true) {
    const text = await new Promise((r) => {
      global["intResolve"] = r;
    });
    return text;
  }
}
/**
 * Asks the user a yes/no question
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>}
 */
async function intConfirm(question = "") {
  question = `${question} [y/n] `.trim();
  while (true) {
    if (canSkipConfirm) {
      console.log(`${question} (auto-confirm)`);
      return true;
    }
    const t = await intQuery(`${question} `);
    process.stdout.write("\n");
    if (t.trim().startsWith("y")) {
      return true;
    } else if (t.trim().startsWith("n")) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Validates user input based on a provided function
 * @param {string} subject - Prompt message
 * @param {(text: string) => Promise<boolean | string | Error | null | undefined>} func - Validation function
 * @returns {Promise<string>} - Validated user input
 */
async function intValid(subject = "", func = async (t) => false) {
  while (true) {
    const text = await intQuery(`${subject}:`);
    try {
      const result = await func(text);
      if (result === true) {
        return text;
      }
      if (typeof result === "string" && result) {
        return result;
      }
      if (result instanceof Error) {
        throw result;
      }
      console.log("Invalid. Try again.");
    } catch (err) {
      console.log(`Invalid: ${err.message}. Try again.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Allows the user to select an option from a provided list
 * @param {string} subject - Prompt message
 * @param {string[]} options - List of selectable options
 * @param {boolean} [printOptions] - Whether or not to display the options
 * @returns {Promise<string|void>} - Selected option
 */
async function intSelect(subject = "", options = [], printOptions = false) {
  return await intValid(subject + printOptions ? options.map((o) => `\n  ${o}`).join("") : "", async (i) => {
    const option = options.find((o) => o.trim() === i.trim());
    if (!option) {
      return;
    }
    return option;
  });
}
