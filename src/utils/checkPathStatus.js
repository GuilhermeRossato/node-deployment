import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} PathStatus
 * @property {string} path - The resolved path
 * @property {string} name - The basename of the path
 * @property {Object} type - The type of the path
 * @property {boolean} type.file - Indicates if the path is a file
 * @property {boolean} type.dir - Indicates if the path is a directory
 * @property {boolean} type.bare - Indicates if the path is git bare repository
 * @property {boolean} type.proj - Indicates if the path is configured with this tool
 * @property {string[] | null} children - Name of the children of the path if it is a directory
 * @property {string | null} parent - Parent directory of the path if it exists
 * @property {number | null} mtime - Modified time of the path
 */

/**
 * Check the status of a given path.
 * @param {string | string[] | {path: string} | PathStatus} target
 * @returns {Promise<PathStatus>} The status of the path
 */
export async function checkPathStatus(target) {
  target = path.resolve(
    ...(target instanceof Array
      ? target
      : typeof target === "string"
      ? [target]
      : typeof target === "object" && typeof target.path === "string"
      ? [target.path]
      : [""])
  );
  const s = {
    path: target.replace(/\\/g, "/"),
    name: path.basename(target),
    type: {
      file: false,
      dir: false,
      bare: false,
      proj: false,
    },
    children: null,
    parent: null,
    mtime: null,
  };
  try {
    await fs.promises.stat(path.dirname(target));
    s.parent = path.dirname(target).replace(/\\/g, "/");
    const stat = await fs.promises.stat(target);
    s.mtime = stat.mtimeMs;
    s.type.dir = stat.isDirectory && stat.isDirectory();
    s.type.file = stat.isFile && stat.isFile();
    s.children = s.type.dir ? await fs.promises.readdir(target) : null;
  } catch (err) {
    s.type.dir = false;
    s.type.file = false;
  }
  if (checkPathStatusContains(s, ["HEAD", "hooks", "config"])) {
    try {
      const config = await fs.promises.readFile(path.resolve(target, "config"), "utf-8");
      s.type.bare = config.replace(/\s/g, "").includes("bare=");
    } catch (err) {
      s.type.bare = false;
    }
    try {
      const deploy = await checkPathStatus([s.path, process.env.DEPLOYMENT_FOLDER_NAME]);
      if (
        deploy.type.dir &&
        s.children instanceof Array &&
        s.children.includes("node-deploy.cjs") &&
        s.children.includes(".env")
      ) {
        s.type.proj = true;
      }
    } catch (err) {
      s.type.proj = false;
    }
  }
  return s;
}

/**
 * Check the status of a given path syncronously
 * @param {string | string[] | {path: string} | PathStatus} target
 * @returns {PathStatus} The status of the path
 */
export function checkPathStatusSync(target) {
  target = path.resolve(
    ...(target instanceof Array
      ? target
      : typeof target === "string"
      ? [target]
      : typeof target === "object" && typeof target.path === "string"
      ? [target.path]
      : [""])
  );
  const s = {
    path: target.replace(/\\/g, "/"),
    name: path.basename(target),
    type: {
      file: false,
      dir: false,
      bare: false,
      proj: false,
    },
    children: null,
    parent: null,
    mtime: null,
  };
  try {
    fs.statSync(path.dirname(target));
    s.parent = path.dirname(target).replace(/\\/g, "/");
    const stat = fs.statSync(target);
    s.mtime = stat.mtimeMs;
    s.type.dir = stat.isDirectory && stat.isDirectory();
    s.type.file = stat.isFile && stat.isFile();
    s.children = s.type.dir ? fs.readdirSync(target) : null;
  } catch (err) {
    s.type.dir = false;
    s.type.file = false;
  }
  if (checkPathStatusContains(s, ["HEAD", "hooks", "config"])) {
    try {
      const config = fs.readFileSync(path.resolve(target, "config"), "utf-8");
      s.type.bare = config.replace(/\s/g, "").includes("bare=");
    } catch (err) {
      s.type.bare = false;
    }
    try {
      const deploy = checkPathStatusSync([s.path, process.env.DEPLOYMENT_FOLDER_NAME]);
      if (
        deploy.type.dir &&
        s.children instanceof Array &&
        s.children.includes("node-deploy.cjs") &&
        s.children.includes(".env")
      ) {
        s.type.proj = true;
      }
    } catch (err) {
      s.type.proj = false;
    }
  }
  return s;
}

/**
 * @param {PathStatus} status
 */
function checkPathStatusContains(status, children = []) {
  if (!status.type.dir || !(status.children instanceof Array) || status.children.length < children.length) {
    return false;
  }
  if (children.some((child) => !status.children.includes(child))) {
    return false;
  }
  return true;
}
