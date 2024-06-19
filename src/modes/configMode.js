import fs from "node:fs";
import path from "node:path";
import { executeWrappedSideEffect } from "../lib/executeWrappedSideEffect.js";
import { executeCommandPredictably } from "../lib/executeCommandPredictably.js";
import { checkPathStatus } from "../lib/checkPathStatus.js";
import { downloadReleaseFile } from "./downloadReleaseFile.js";
import getLastCommitHash from "./getLastCommitHash.js";
import sendInternalRequest from "../lib/sendInternalRequest.js";
import { spawnManagerProcess } from "../lib/spawnManagerProcess.js";

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
 * @param {Awaited<ReturnType<checkPathStatus>>} cand
 * @param {any} rec
 * @returns {Promise<string | undefined>}
 */
async function intVerifyCandidate(cand, rec = {}) {
  if (!cand.parent) {
    console.log(
      `Specified path does not exist (Parent not found at "${path.dirname(
        path.resolve(cand.path)
      )}")`
    );
    const conf = await intConfirm(
      `Create and initialize a repository at "${path.basename(cand.path)}"?`
    );
    if (!conf) {
      return;
    }
    rec.confirmCreate = true;
    rec.origin = rec.origin || "input";
    return cand.path;
  }
  if (!cand.exists) {
    const parent = await checkPathStatus(cand.parent);
    // Find file name match
    if (parent.type.dir && parent.children instanceof Array) {
      const names = parent.children.filter(
        cand.name.startsWith("*")
          ? (name) => name.endsWith(cand.name.substring(1))
          : (name) =>
              name.startsWith(
                cand.name.endsWith("*")
                  ? cand.name.substring(0, cand.name.length - 1)
                  : cand.name
              )
      );
      const checks = await Promise.all(
        names.map((name) => checkPathStatus([parent.path, name]))
      );
      const match =
        checks.find((p) => p.type.initialized) ||
        checks.find((p) => p.type.bare) ||
        checks.find((p) => p.type.dir);
      if (match) {
        console.log(
          `Specified path does not exist but a close match was found: "${match.name}"`
        );
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
          rec.origin = rec.origin || "match";
          return cand.path;
        }
      }
    }
    if (rec.origin !== "arg") {
      console.log(
        `Specified path does not exist ("${
          cand.name
        }" was not found at "${path.dirname(path.resolve(cand.path))}")`
      );
    }
    const conf = await intConfirm(
      `Create and initialize "${path.basename(cand.path)}"?`
    );
    if (!conf) {
      return;
    }
    rec.origin = rec.origin || "input";
    rec.confirmCreate = true;
    return cand.path;
  }
  if (cand.type.initialized) {
    console.log(`Specified git bare repository at "${cand.path}"`);
    rec.confirmCreate = false;
    rec.origin = rec.origin || "target";
    return cand.path;
  }
  if (cand.type.bare) {
    console.log(
      `Specified an unitialized git bare repository at "${cand.path}"`
    );
    const conf = await intConfirm(
      `Initialize the bare repository at "${cand.name}"?`
    );
    if (!conf) {
      return;
    }
    rec.confirmCreate = true;
    rec.origin = rec.origin || "target";
    return cand.path;
  }
  if (cand.type.file) {
    console.log(
      `Specified path is not a folder ("${
        cand.name
      }" is a file of "${path.dirname(path.resolve(cand.parent))}")`
    );
    return;
  }
  if (cand.type.dir && cand.children.length === 0) {
    console.log(
      `Specified an empty folder ("${cand.name}" at "${path.dirname(
        path.resolve(cand.parent)
      )}")`
    );
    const conf = await intConfirm(
      `Initialize a new git bare repository at "${cand.name}"?`
    );
    if (!conf) {
      return;
    }
    rec.confirmCreate = true;
    rec.origin = rec.origin || "target";
    return cand.path;
  }
  if (cand.type.dir) {
    const extras = cand.children.filter((f) => !isFileFromBareRepo(f));
    if (extras.length <= 3) {
      console.log(
        `Specified folder "${cand.name}" contains`,
        cand.children.length,
        `children`
      );
      if (extras.length !== 0) {
        console.log(
          `Ignoring some unexpected files inside: ${extras.join(", ")}`
        );
      }
      rec.confirmCreate = false;
      rec.origin = rec.origin || "target";
      return cand.path;
    }
    if (extras.length > 3) {
      console.log(
        `Specified folder "${cand.name}" contains`,
        extras.length,
        "unexpected children"
      );
      let line = `${extras.join(", ")}`;
      const limit = (process.stdout.columns || 80) - 8 - 1;
      if (line.length >= limit) {
        line = `${line.substring(0, limit - 5)}, ...`;
      }
      process.stdout.write(`\n`);
      process.stdout.write(`Path :  ${cand.path}\n`);
      process.stdout.write(`Files:  ${line}\n`);
      process.stdout.write(`\n`);
      const conf = await intConfirm(
        "Are you sure you want to select this folder?"
      );
      if (!conf) {
        return;
      }
      rec.confirmCreate = false;
      rec.origin = rec.origin || "target";
      return cand.path;
    }
  }
  throw new Error("Unhandled");
}

async function getRepositoryPathInteractively(options) {
  const rec = {
    path: "",
    origin: "",
    confirmCreate: false,
  };
  let result = "";
  let cand;
  const deployName = process.env.DEPLOYMENT_FOLDER_NAME || "deployment";
  if (options.dir) {
    cand = await checkPathStatus(options.dir);
    console.log(
      cand.type.dir
        ? "Folder path from parameter"
        : cand.type.file
        ? "File path from parameter"
        : "Specified path from parameter",
      cand.exists ? "exists:" : "does not exist:",
      cand.path
    );
    rec.origin = "arg";
    if (cand.type.initialized) {
      console.log(
        `Specified initialized git bare repository at "${cand.path}"`
      );
      rec.path = cand.path;
      rec.confirmCreate = false;
      return rec;
    }
    if (cand.type.bare) {
      console.log(`Specified git bare repository at "${cand.path}"`);
      rec.path = cand.path;
      rec.confirmCreate = false;
      return rec;
    }
    if (cand.type.dir) {
      rec.path = cand.path;
      rec.confirmCreate = false;
      return rec;
    }
  }
  if (!cand) {
    cand = await checkPathStatus(process.cwd());
    if (rec && cand.type.bare && cand.type.initialized) {
      rec.path = cand.path;
      rec.origin = "arg";
      return rec;
    }
    const parent = await checkPathStatus(cand.parent);
    if (
      cand.type.dir &&
      cand.name === deployName &&
      parent.type.bare &&
      parent.type.initialized
    ) {
      rec.origin = "parent";
      cand = parent;
    } else if (!cand.type.bare) {
      cand = null;
    } else {
      rec.origin = "cwd";
    }
  }
  if (cand) {
    result = await intVerifyCandidate(cand, rec);
    if (result && typeof result === "string") {
      rec.path = result;
      rec.origin = "arg";
      rec.confirmCreate = false;
      return rec;
    }
    cand = null;
  }
  rec.path = await intValid(
    "Provide the git bare repository path",
    async (text) => {
      const res = await checkPathStatus(text.trim());
      return await intVerifyCandidate(res, rec);
    }
  );
  return rec;
}

async function initializeGitRepository(targetPath) {
  console.log(
    "Initializing git repository named",
    JSON.stringify(path.basename(targetPath))
  );
  const status = await checkPathStatus(targetPath);
  if (!status.exists) {
    await executeWrappedSideEffect("Create repository directory", async () => {
      await fs.promises.mkdir(targetPath, { recursive: true });
    });
  }
  if (!status.type.bare) {
    await executeWrappedSideEffect(
      'Initialize repository ("git init")',
      async () => {
        const result = await executeCommandPredictably(
          "git init --bare",
          targetPath,
          5_000
        );
        if (result.exitCode !== 0 || result.error) {
          console.log("Git init failed with exit code", result.exitCode);
          console.log(result.output);
          throw new Error("Git init Failed");
        }
      },
      targetPath
    );
  }
  const updateFilePath = path.resolve(targetPath, "hooks", "post-update");
  const up = await checkPathStatus(updateFilePath);
  if (!up.exists) {
    await executeWrappedSideEffect(
      "Create and enable post-update hook",
      async (updateFilePath) => {
        const lines = [
          "#!/bin/bash",
          `"${process.argv[0]}" ./${process.env.DEPLOYMENT_FOLDER_NAME}/node-deploy.cjs --scheduler $*`,
        ];
        await fs.promises.writeFile(
          updateFilePath,
          lines.join("\n") + "\n",
          "utf-8"
        );
        console.log("Created git hook file");
        const result = await executeCommandPredictably(
          `chmod +x "${updateFilePath}"`,
          targetPath,
          5_000
        );
        if (result.exitCode !== 0 || result.error) {
          console.log(
            "Updating execution permission of git hook failed with exit code",
            result.exitCode
          );
          console.log(result.output);
          throw new Error("Updating execution permission of git hook failed");
        }
        console.log("Enabled git hook file");
      },
      updateFilePath
    );
  }
  const deployFolderPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_NAME
  );
  const dep = await checkPathStatus(deployFolderPath);
  if (!dep.exists) {
    await executeWrappedSideEffect("Create deployment folder", async () => {
      await fs.promises.mkdir(deployFolderPath, { recursive: true });
      console.log("Created deployment folder at", deployFolderPath);
    });
  }
  const deployScriptPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_NAME,
    "node-deploy.cjs"
  );
  const scr = await checkPathStatus(deployScriptPath);
  if (!scr.exists) {
    await executeWrappedSideEffect(
      "Copy deployment script",
      async (file) => {
        const selfPath = path.resolve(
          path.dirname(path.resolve(process.cwd(), process.argv[1])),
          "node-deploy.cjs"
        );
        let buffer;
        if (fs.existsSync(selfPath)) {
          buffer = await fs.promises.readFile(selfPath);
        } else {
          const response = await downloadReleaseFile();
          if (response) {
            buffer = response.buffer;
          }
        }
        if (!buffer) {
          throw new Error(`Could not get self script at ${selfPath}`);
        }
        await fs.promises.writeFile(file, buffer);
        console.log("Copied deployment script to", file);
      },
      deployScriptPath
    );
  }
  await initializeConfigFile(targetPath);
  console.log(
    "Initialization of git bare repository finished for",
    JSON.stringify(path.basename(targetPath)),
    "at",
    JSON.stringify(path.dirname(targetPath))
  );
}

async function initializeConfigFile(targetPath) {
  const envPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_NAME || "deployment",
    ".env"
  );
  const cfg = await checkPathStatus(envPath);
  const text = cfg.exists ? await fs.promises.readFile(envPath, "utf-8") : "";
  const pairs = text
    .split("\n")
    .map((f) => (f.includes("=") ? f.trim() : ""))
    .filter((f) => f.length)
    .map((a) => [
      a.substring(0, a.indexOf("=")),
      a.substring(a.indexOf("=") + 1),
    ]);

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
    cfg.exists ? "Existing" : "Missing",
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
  console.log(
    "Config file will be rewritten with",
    newText.length,
    "chars (previous size was",
    text.length,
    ")"
  );
  await executeWrappedSideEffect(
    `${cfg.exists ? "Update" : "Create"} config file`,
    async () => {
      await fs.promises.writeFile(envPath, newText, "utf-8");
      console.log(
        `${cfg.exists ? "Updated" : "Created"} deployment config file at`,
        JSON.stringify(path.dirname(envPath))
      );
    }
  );
  return true;
}

let canSkipConfirm = false;
/**
 * @param {import("../getProgramArgs.js").Options} options
 */
export async function initConfig(options) {
  canSkipConfirm = options.yes;
  const obj = await getRepositoryPathInteractively(options);
  const targetPath =
    obj && obj.path && typeof obj.path === "string" ? obj.path : process.cwd();
  let status = await checkPathStatus(targetPath);
  if (!status.exists && obj.confirmCreate !== true) {
    console.log(
      `Specified path does not exist ("${
        status.parent
          ? path.basename(targetPath)
          : path.basename(path.dirname(targetPath))
      }" ${status.exists ? "at" : "was not found at"} "${
        status.parent
          ? path.dirname(targetPath)
          : path.dirname(path.dirname(targetPath))
      }")`
    );
    const conf = await intConfirm(
      `Create and initialize a repository at "${path.basename(targetPath)}"?`
    );
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.isNew = true;
  }
  if (status.type.dir && !status.type.bare && obj.confirmCreate !== true) {
    if (status.children.length === 0) {
      console.log(
        `Specified directory is empty ("${path.basename(
          targetPath
        )}" has no children at "${path.dirname(targetPath)}")`
      );
    } else {
      console.log(
        `Specified directory is not a bare git repository ("${path.basename(
          targetPath
        )}" at "${path.dirname(targetPath)}")`
      );
    }
    const conf = await intConfirm(
      `Initialize the git bare repository "${path.basename(targetPath)}"?`
    );
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.isNew = true;
  }
  if (!status.exists || (status.type.dir && !status.type.bare)) {
    await initializeGitRepository(targetPath);
    status = await checkPathStatus(targetPath);
  }
  if (status.type.dir && status.type.bare && !status.type.initialized) {
    console.log(
      `Specified bare repository is not initialized ("${path.basename(
        targetPath
      )}" at "${path.dirname(targetPath)}")`
    );
    const conf = await intConfirm(
      `Initialize the git bare repository "${path.basename(targetPath)}"?`
    );
    if (!conf) {
      throw new Error("Unconfirmed");
    }
    await initializeGitRepository(targetPath);
  }
  const hash = await getLastCommitHash(targetPath);
  if (typeof hash === "string") {
    console.log("Verifying manager process after confirming commit");
    const response = await sendInternalRequest("manager", "status");
    const offline = response.error && response.stage === "network";
    if (offline) {
      console.log("Starting manager process as it is offline");
      await spawnManagerProcess(options.debug, options.sync);
    } else {
      console.log("Manager process response:", response);
    }
  }
  intPause();
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
    process.stdin.on("data", (data) =>
      global["intResolve"](data.toString("utf-8"))
    );
  }
  if (typeof subject === "string") {
    console.log(
      "User input",
      JSON.stringify(
        subject.substring(0, 32) + (subject.length > 32 ? "..." : "")
      )
    );
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
  return await intValid(
    subject + printOptions ? options.map((o) => `\n  ${o}`).join("") : "",
    async (i) => {
      const option = options.find((o) => o.trim() === i.trim());
      if (!option) {
        return;
      }
      return option;
    }
  );
}
