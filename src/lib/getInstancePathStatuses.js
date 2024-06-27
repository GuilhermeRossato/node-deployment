import path from "path";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { getParsedProgramArgs } from "./getProgramArgs.js";

export async function getInstancePathStatuses(options = undefined) {
  if (!options) {
    options = getParsedProgramArgs(false).options;
  }
  let deploymentPath;
  try {
    deploymentPath = path.resolve(options.dir || process.cwd(), process.env.DEPLOYMENT_FOLDER_NAME || "deployment");
  } catch (err) {
    throw new Error(`Could not resolve deploy folder path: ${err.message}`);
  }
  try {
    const oldInstancePath = process.env.OLD_INSTANCE_FOLDER_PATH
      ? path.resolve(deploymentPath, process.env.OLD_INSTANCE_FOLDER_PATH)
      : "";
    const prevInstancePath = path.resolve(deploymentPath, process.env.PREV_INSTANCE_FOLDER_PATH || "previous-instance");
    const nextInstancePath = path.resolve(deploymentPath, process.env.NEXT_INSTANCE_FOLDER_PATH || "upcoming-instance");
    const currInstancePath = path.resolve(
      deploymentPath,
      process.env.CURR_INSTANCE_FOLDER_PATH || process.env.INSTANCE_FOLDER_PATH || "current-instance"
    );
    const deploy = await checkPathStatus(deploymentPath);
    const old = oldInstancePath ? await checkPathStatus(oldInstancePath) : null;
    const prev = prevInstancePath ? await checkPathStatus(prevInstancePath) : null;
    const next = nextInstancePath ? await checkPathStatus(nextInstancePath) : null;
    const curr = currInstancePath ? await checkPathStatus(currInstancePath) : null;
    return {
      deploy,
      old,
      prev,
      next,
      curr,
    };
  } catch (err) {
    throw new Error(`Could not resolve instance paths: ${err.message}`);
  }
}
