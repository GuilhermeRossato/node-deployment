import fs from "node:fs";
import path from "node:path";
import asyncTryCatchNull from "../utils/asyncTryCatchNull.js";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import { executeGitProcessPredictably } from "../process/executeGitProcessPredictably.js";

export async function getRepoCommitData(repositoryPath, ref) {
  const result = await asyncTryCatchNull(getRepoCommitDataUnsafe(repositoryPath, ref));
  if (!result || result instanceof Error) {
    return {
      error: result instanceof Error ? result : new Error("Could not get commit data"),
      path: "",
      hash: "",
      date: new Date(),
      message: "",
    };
  }
  return result;
}
export async function executeGitCheckout(repositoryPath, targetPath, ref = "") {
  const cmd = `git --work-tree="${repositoryPath}" checkout -f${ref ? ` ${ref}` : ""}`;
  if (!fs.existsSync(targetPath)) {
    console.log("Creating target directory at", JSON.stringify(targetPath));
    await fs.promises.mkdir(targetPath, { recursive: true });
  }
  const result = await executeGitProcessPredictably(cmd, targetPath);
  return result;
}

export async function getRepoCommitDataUnsafe(repositoryPath = "", ref = "") {
  const cmd = `git log --format="%H %cd %cn: %s" --date=iso -1 ${ref ? ` ${ref}` : ""}`;
  const result = await executeGitProcessPredictably(cmd, repositoryPath);
  const text = result.output.toString().trim();
  const [hash, date, hour, tz, ...rest] = text.replace(/\s\s+/g, " ").split(" ");
  return {
    path: repositoryPath,
    hash,
    date: new Date(date + " " + hour + " " + tz),
    message: rest.join(" "),
  };
}

export async function getHashFromRef(targetPath, ref) {
  let root = await checkPathStatus([targetPath]);
  if (!root.type.dir || !root.children.includes("refs")) {
    root = await checkPathStatus([targetPath, ".git"]);
  }
  if (!root.type.dir || !root.children.includes("refs")) {
    throw new Error(`Invalid info ${JSON.stringify(root)}`);
  }
  // Replace refs
  if (ref.startsWith("refs/")) {
    ref = ref.substring(ref.indexOf("/") + 1);
  }
  // Replace head
  if (ref.startsWith("heads/")) {
    ref = ref.substring(ref.indexOf("/") + 1);
  }
  const heads = await checkPathStatus([root.path, "refs", "heads"]);
  const index = heads.type.dir ? heads.children.indexOf(ref) : -1;
  if (index !== -1) {
    const hash = await fs.promises.readFile(path.resolve(heads.path, heads.children[index]), "utf-8");
    return hash.trim();
  }
  throw new Error(`Invalid ref`);
}
