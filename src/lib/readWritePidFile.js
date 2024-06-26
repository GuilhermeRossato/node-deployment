import fs from "fs";
import path from "path";
import { getIntervalString } from "../utils/getIntervalString.js";
import { isProcessRunningByPid } from "../process/isProcessRunningByPid.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { executeWrappedSideEffect } from "./executeWrappedSideEffect.js";
import { getParsedProgramArgs } from "./getProgramArgs.js";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import getDateTimeString from "../utils/getDateTimeString.js";

export async function getPidFileStatus(root, mode) {
  let deploy = await checkPathStatus([root, process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
  if (!deploy.type.dir) {
    deploy = await checkPathStatus([root, ".git", process.env.DEPLOYMENT_FOLDER_NAME || "deployment"]);
  }
  if (!deploy.type.dir) {
    throw new Error(`Deployment folder not found at ${JSON.stringify(deploy.path)}`);
  }
  if (!mode) {
    throw new Error(`Invalid pid file mode: ${mode}`);
  }
  if (mode.includes(".") || mode.includes("/")) {
    mode = mode.substring(mode.lastIndexOf("/") + 1, mode.lastIndexOf("."));
  }
  const name = `${mode}.pid`;
  return await checkPathStatus([deploy.path, name]);
}

export async function writePidFile(mode, pid = null) {
  const { options } = getParsedProgramArgs(false);
  const root = options.dir || process.cwd();
  const status = await getPidFileStatus(root, mode);
  if (status.type.file) {
    options.debug &&
      console.log(
        "Overwriting",
        JSON.stringify(status.name),
        `(updated ${getIntervalString(new Date().getTime() - status.mtime)} ago)`
      );
  }
  pid = (pid || process.pid).toString();
  await executeWrappedSideEffect(
    `${status.type.file ? "Updating" : "Creating"} pid at "./${path.basename(status.parent)}/${status.name}"`,
    async () => {
      await fs.promises.writeFile(status.path, pid);
      options.debug && console.log(status.type.file ? "Updated" : "Created", mode, "pid file at:", status.path);
    }
  );
  return {
    time: new Date().getTime(),
    pid,
    path: status.path,
    read: () => readPidFile(mode),
  };
}

export async function readPidFile(mode) {
  const { options } = getParsedProgramArgs(false);
  const root = options.dir || process.cwd();
  const status = await getPidFileStatus(root, mode);
  if (!status.type.file) {
    return {
      time: NaN,
      pid: null,
      running: false,
      path: status.path,
    };
  }
  const pid = await asyncTryCatchNull(fs.promises.readFile(status.path, "utf-8"));
  const valid = pid && typeof pid === "string" && pid !== "0" && !/\D/g.test(pid.trim());
  const running = valid && (await isProcessRunningByPid(pid));
  return {
    time: status.mtime,
    pid: valid ? parseInt(pid.trim()) : null,
    running,
    path: status.path,
  };
}
