import fs from "node:fs";
import path from "node:path";
import { executeProcessPredictably } from "./executeProcessPredictably.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { getParsedProgramArgs } from "../lib/getProgramArgs.js";

export async function executeGitProcessPredictably(cmd, repoPath = "") {
  if (!repoPath) {
    const { options } = getParsedProgramArgs(false);
    const root = options.dir || process.cwd();
    repoPath = path.resolve(root);
  }
  let status = await checkPathStatus(repoPath);
  // inside deployment folder
  if (
    status.type.dir &&
    (status.children.includes("node-deploy.cjs") ||
      status.name === process.env.DEPLOYMENT_FOLDER_NAME ||
      status.children.includes(".env")) &&
    !status.children.includes("refs") &&
    !status.children.includes("config") &&
    !status.children.includes("hooks")
  ) {
    const par = await checkPathStatus(path.dirname(status.path));
    if (
      !(
        par.type.dir &&
        (par.children.includes("node-deploy.cjs") ||
          par.name === process.env.DEPLOYMENT_FOLDER_NAME ||
          par.children.includes(".env")) &&
        !par.children.includes("refs") &&
        !par.children.includes("config") &&
        !par.children.includes("hooks")
      )
    ) {
      // console.log(`Raising from repository "${status.name}" to parent "${path.basename(status.parent)}"`);
      status = par;
    }
  }
  if (!status.type.dir) {
    throw new Error(`Could not find a repository folder path at "${status.path}"`);
  }
  const config = await checkPathStatus(
    status.children.includes("config") ? [status.path, "config"] : [status.path, ".git", "config"]
  );
  // inside .git folder
  if (
    status.type.dir &&
    status.name === ".git" &&
    status.children.includes("hooks") &&
    status.children.includes("refs") &&
    status.children.includes("config")
  ) {
    const parent = await checkPathStatus(status.parent);
    if (parent.type.dir && parent.children.includes(".git")) {
      // console.log(`Raising from repository "${status.name}" to parent "${path.basename(status.parent)}"`);
      status = parent;
    }
  }
  if (!status.type.dir) {
    throw new Error(`Could not find a repository folder path at "${status.path}"`);
  }
  let bare = false;
  if (config.type.file) {
    try {
      const text = await fs.promises.readFile(path.resolve(config.path), "utf-8");
      bare = text.replace(/\s/g, "").includes("bare=true");
    } catch (err) {
      console.log(
        `Warning: Failed while reading git config file for repository "${path.basename(status.path)}" at "${
          config.path
        }"`
      );
      bare = false;
    }
  }
  if (bare && status.name === ".git" && status.type.dir && status.children.includes("config")) {
    repoPath = path.dirname(status.path);
  } else {
    repoPath = status.path;
  }
  // console.log("Executing git command at", JSON.stringify(repoPath));
  const result = await executeProcessPredictably(cmd.trim(), repoPath, {
    timeout: 10_0000,
    throws: true,
    shell: true,
  });
  if (result.exit !== 0) {
    throw new Error(`Unexpected git exit (code ${result.exit}): ${JSON.stringify(result)}`);
  }
  if (typeof result.output !== "string" && !result.output) {
    result.output = "";
  }
  if (typeof result.output !== "string") {
    throw new Error(`Unexpected git output (exit code ${result.exit}): ${JSON.stringify(result)}`);
  }
  return result;
}
