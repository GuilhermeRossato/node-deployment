import fs from "node:fs";
import path from "node:path";
import readLogFile from "./readLogFile.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { getParsedProgramArgs } from "../lib/getProgramArgs.js";
import { loadEnvSync } from "../utils/loadEnvSync.js";
import recursivelyIterateDirectoryFiles from "../utils/recursivelyIterateDirectoryFiles.js";

/**
 * @param {string[]} prefixes File name prefix list to filter
 * @param {string[]} names
 * @param {Buffer[]} buffers
 * @param {number} size
 */
export async function getLastLogs(prefixes = [], names = [], buffers = [], size = 4096) {
  const { options } = getParsedProgramArgs(false);
  let status = await checkPathStatus(options.dir || process.cwd());
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
      status = par;
    }
  }
  // outside .git folder
  if (
    status.type.dir &&
    status.children.includes(".git") &&
    (!status.children.includes("hooks") || !status.children.includes("refs") || !status.children.includes("config"))
  ) {
    const inside = await checkPathStatus([status.path, ".git"]);
    if (
      inside.type.dir &&
      inside.children.includes(process.env.DEPLOYMENT_FOLDER_NAME) &&
      inside.children.includes("refs") &&
      inside.children.includes("config")
    ) {
      status = inside;
    }
  }
  return await getProjectRepoLogs(status.path, prefixes, names, buffers, size);
}

async function getProjectRepoLogs(projectPath, prefixes = [], names = [], buffers = [], size = 4096) {
  const root = `${path.resolve(projectPath)}/`;
  const unfiltered = await getProjectRepoLogsFiles(projectPath);

  const getBase = (str) =>
    [str.replace(/\\/g, "/")]
      .map((n) => n.substring(n.lastIndexOf("/") + 1, n.includes(".") ? n.lastIndexOf(".") : n.length))
      .join("");

  const bases = prefixes.map((n) => getBase(n));

  const fileList = unfiltered.filter((f) => {
    if (!bases.length) {
      return true;
    }
    const base = getBase(f.path);
    if (bases.some((p) => base.startsWith(p))) {
      return true;
    }
    return false;
  });

  const list = [];
  for (let i = 0; i < fileList.length; i++) {
    const logName = fileList[i].path.substring(root.length);
    if (!names.includes(logName)) {
      names.push(logName);
    }
    const result = await readLogFile(fileList[i].path, -size, buffers[i]);
    if (!buffers[i]) {
      buffers[i] = result.buffer;
    }
    const entries = result.list.map((o, i, a) => ({
      file: logName,
      time: a
        .slice(0, i + 1)
        .reverse()
        .map((a) => a.time)
        .find((a) => a && !isNaN(a)),
      src: o.src,
      pid: o.pid,
      text: o.text,
    }));
    for (const e of entries) {
      if (e.time && !isNaN(e.time)) {
        list.push(e);
      }
    }
  }
  return {
    list: list.sort((a, b) => a.time - b.time),
    buffers,
    names,
    prefixes,
    projectPath,
  };
}

/**
 * @param {string} target
 */
async function getProjectRepoLogsFiles(target) {
  const status = await checkPathStatus(target);
  if (!status.type.dir) {
    throw new Error(`Invalid target: ${status.path}`);
  }
  if (!status.children.includes(process.env.DEPLOY_FOLDER_NAME || "deployment")) {
    throw new Error(`Invalid unitialized target: ${status.path}`);
  }
  const deploy = await checkPathStatus([status.path, process.env.DEPLOY_FOLDER_NAME || "deployment"]);
  if (!deploy.type.dir || !deploy.children.includes("node-deploy.cjs")) {
    throw new Error(`Invalid target deploy folder: ${deploy.path}`);
  }
  const everything = await recursivelyIterateDirectoryFiles(deploy.path, (name, _path, stat, depth) => {
    if (depth >= 3) {
      return false;
    }
    if (stat.isFile() && name.endsWith(".log")) {
      return true;
    }
    if (stat.isDirectory() && name !== "node_modules") {
      return true;
    }
    return false;
  });
  const statusList = await Promise.all(everything.map((f) => checkPathStatus(f)));
  const fileList = [];
  for (const s of statusList) {
    if (fileList.find((f) => f.path === s.path)) {
      continue;
    }
    if (s.type.file && s.name.endsWith(".log")) {
      fileList.push(s);
    }
  }
  return fileList;
}
