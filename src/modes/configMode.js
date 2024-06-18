import fs from "node:fs";
import path from "node:path";
import { executeCommandPredictably } from "../lib/executeCommandPredictably.js";
import { checkPathStatus } from "../lib/checkPathStatus.js";

async function getRepositoryPathInteractively(options) {
  let result = "";
  let origin = "?";
  let isNew = false;
  let res;
  const check = checkPathStatus;

  if (options.dir) {
    res = await check(options.dir);
    if (res.type.bare) {
      console.debug(`Specified Git Bare Repository at "${res.path}"`);
      origin = "arg";
      return {
        path: res.path,
        origin,
        isNew,
      };
    }
    if (res.type.dir) {
      console.debug(`Specified Directory at "${res.path}"`);
      origin = "arg";
      return {
        path: res.path,
        origin,
        isNew,
      };
    }
    if (!res.exists) {
      const parent = await check(res.parent);
      // Find file name match
      if (parent.type.dir && parent.children instanceof Array) {
        const names = parent.children.filter(
          res.name.startsWith("*")
            ? (name) => name.endsWith(res.name.substring(1))
            : (name) =>
                name.startsWith(
                  res.name.endsWith("*")
                    ? res.name.substring(0, res.name.length - 1)
                    : res.name
                )
        );
        const checks = await Promise.all(
          names.map((name) => check([parent.path, name]))
        );
        const match =
          checks.find((p) => p.type.bare) || checks.find((p) => p.type.dir);
        if (match) {
          console.log(
            `Specified path does not exist but "${match.name}" was found in "${match.parent}"`
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
            origin = "match";
            return {
              path: res.path,
              origin,
              isNew,
            };
          }
        }
      }
      console.log(
        `Specified path does not exist ("${res.name}" was not found at "${res.parent}")`
      );
      const conf = await intConfirm(
        `Create a new Git Bare Repository at "${res.path}"?`
      );
      if (!conf) {
        return;
      }
      origin = "input";
      isNew = true;
      return {
        path: res.path,
        origin,
        isNew,
      };
    }
  }
  if (
    !options.dir ||
    path.resolve(process.cwd()) !== path.resolve(options.dir)
  ) {
    res = await check(process.cwd());
    if (res.type.bare) {
      const conf = await confirm(
        `Select the Git Bare Repository at "${process.cwd()}"?`
      );
      if (conf) {
        result = process.cwd();
        console.debug(`Specified Git Bare Repository at "${res.path}"`);
        origin = "current";
        return {
          path: res.path,
          origin,
          isNew,
        };
      }
    }
  }
  result = await intValid("Git Bare Repository Path", async (text) => {
    const res = await check(text.trim());
    if (!res.parent) {
      console.log(
        `Specified path does not exist (Parent not found at "${path.dirname(
          res.path
        )}")`
      );
      const conf = await intConfirm(
        `Create a new Git Bare Repository at "${res.path}" (and its parent folder)?`
      );
      if (!conf) {
        return;
      }
      isNew = true;
      origin = "input";
      return res.path;
    }
    if (!res.exists) {
      const parent = await check(res.parent);
      // Find file name match
      if (parent.type.dir && parent.children instanceof Array) {
        const names = parent.children.filter(
          res.name.startsWith("*")
            ? (name) => name.endsWith(res.name.substring(1))
            : (name) =>
                name.startsWith(
                  res.name.endsWith("*")
                    ? res.name.substring(0, res.name.length - 1)
                    : res.name
                )
        );
        const checks = await Promise.all(
          names.map((name) => check([parent.path, name]))
        );
        const match =
          checks.find((p) => p.type.bare) || checks.find((p) => p.type.dir);
        if (match) {
          console.log(
            `Specified path does not exist but "${match.name}" was found in "${match.parent}"`
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
            origin = "match";
            return res.path;
          }
        }
      }
      console.log(
        `Specified path does not exist ("${res.name}" was not found at "${res.parent}")`
      );
      const conf = await intConfirm(
        `Create a new Git Bare Repository at "${res.path}"?`
      );
      if (!conf) {
        return;
      }
      origin = "input";
      isNew = true;
      return res.path;
    }
    if (res.type.bare) {
      console.log(`Specified Git Bare Repository at "${res.path}"`);
      origin = "target";
      return res.path;
    }
    if (res.type.file) {
      console.log(
        `Specified path is not a folder ("${res.name}" is a file at "${res.parent}")`
      );
      return;
    }
    if (res.type.dir) {
      console.debug(`Specified a folder ("${res.name}" at "${res.parent}")`);
      return res.path;
    }
  });
  return {
    path: result,
    origin,
    isNew,
  };
}


async function initializeGitRepository(targetPath) {
  const status = await checkPathStatus(targetPath);
  if (!status.exists) {
    await execSideEffect("create project dir", fs.promises.mkdir, targetPath, {
      recursive: true,
    });
  }
  if (!status.type.bare) {
    await execSideEffect(
      "git init --bare",
      async (targetPath) => {
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
    await execSideEffect(
      "post-update hook creation",
      async (updateFilePath) => {
        const lines = [
          "#!/bin/bash",
          `"${process.argv[0]}" ./${process.env.DEPLOYMENT_FOLDER_PATH}/node-deploy.cjs --scheduler $*`,
        ];
        await fs.promises.writeFile(
          updateFilePath,
          lines.join("\n") + "\n",
          "utf-8"
        );
        console.log('Created git hook file');
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
        console.log('Enabled git hook file');
      },
      updateFilePath
    );
  }
  const deployFolderPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_PATH
  );
  const dep = await checkPathStatus(deployFolderPath);
  if (!dep.exists) {
    await execSideEffect("mkdir", fs.promises.mkdir, deployFolderPath, {
      recursive: true,
    });
    console.log('Created deployment folder at', deployFolderPath);
  }
  const deployScriptPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_PATH,
    "node-deploy.cjs"
  );
  const scr = await checkPathStatus(deployScriptPath);
  if (!scr.exists) {
    await execSideEffect(
      "main script creation",
      async (file) => {
        const selfPath = path.resolve(path.dirname(path.resolve(process.cwd(), process.argv[1])), 'node-deploy.cjs');
        if (!fs.existsSync(selfPath)) {
          throw new Error(`Could not find self path at ${selfPath}`);
        }
        const text = await fs.promises.readFile(selfPath, "utf-8");
        await fs.promises.writeFile(file, text, "utf-8");
        console.log('Copied deployment script to', file);
      },
      deployScriptPath
    );
  }
  const envPath = path.resolve(
    targetPath,
    process.env.DEPLOYMENT_FOLDER_PATH,
    "node-deploy.cjs"
  );
  const cfg = await checkPathStatus(envPath);
  if (!cfg.exists) {
    await execSideEffect(
      "config file creation",
      async (envPath) => {
        const lines = [
          `GIT_BARE_REPO_PATH=${targetPath}`,
          `LOG_FOLDER_PATH=${process.env.LOG_FOLDER_PATH || "logs"}`,
          `DEPLOYMENT_FOLDER_PATH=${
            process.env.DEPLOYMENT_FOLDER_PATH || "deployment"
          }`,
          `OLD_INSTANCE_FOLDER_PATH=${
            process.env.OLD_INSTANCE_FOLDER_PATH || "old-inst"
          }`,
          `INSTANCE_FOLDER_PATH=${
            process.env.INSTANCE_FOLDER_PATH || "instance"
          }`,
          `NEXT_INSTANCE_FOLDER_PATH=${
            process.env.NEXT_INSTANCE_FOLDER_PATH || "next-inst"
          }`,
          `DEPLOYMENT_SETUP_DATE_TIME=${new Date().toISOString()}`,
        ];
        await fs.promises.writeFile(
          envPath,
          lines.join("\n") + "\n",
          "utf-8"
        );
        console.log('Created deployment config at', envPath);
      },
      envPath
    );
  }
  console.log(
    "Initialization of git bare repository finished for",
    JSON.stringify(path.basename(targetPath)),
    "at",
    JSON.stringify(path.dirname(targetPath))
  );
}

let canExecSideEffect = true;
let canSkipConfirm = false;
async function execSideEffect(type, func, ...args) {
  if (canExecSideEffect) {
    return await func(...args);
  } else {
    console.log(
      `Skipping disabled side effect [${type}] at ${JSON.stringify(args[0])}`
    );
  }
}

/**
 * @param {import("../getProgramArgs.js").Options} options
 */
export async function initConfig(options) {
  canExecSideEffect = !options.dry;
  canSkipConfirm = options.yes;
  const obj = await getRepositoryPathInteractively(options);
  const targetPath =
    obj && obj.path && typeof obj.path === "string" ? obj.path : process.cwd();
  let status = await checkPathStatus(targetPath);
  if (!status.exists && obj.isNew !== true) {
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
      `Create a new Git Bare Repository at "${targetPath}"?`
    );
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    obj.isNew = true;
  }
  if (!status.exists) {
    await initializeGitRepository(targetPath);
    status = await checkPathStatus(targetPath);
  }
  if (status.type.dir && status.type.bare && !status.children.includes(process.env.DEPLOYMENT_FOLDER_PATH)) {
    console.log(
      `Specified path is an uninitialized bare repository ("${path.basename(
        targetPath
      )}" at "${path.dirname(targetPath)}")`
    );
    const conf = await intConfirm(
      `Do you want to initialize the Git Bare Repository at "${targetPath}"?`
    );
    if (!conf) {
      throw new Error("Setup not confirmed");
    }
    await initializeGitRepository(targetPath);
  }
  intPause();
  throw new Error("Unimplemented scheduling");
  // TODO: perform scheduling of first state if it exist
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
    console.log(subject);
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
    console.log(`${question} `);
    const t = await intQuery();
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
