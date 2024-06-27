import fs from "node:fs";
import path from "node:path";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import fetchProjectReleaseFileSource from "../lib/fetchProjectReleaseFileSource.js";
import getDateTimeString from "../utils/getDateTimeString.js";

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initUpgrade(options) {
  const release = await fetchProjectReleaseFileSource();
  console.log("Loaded", JSON.stringify(release.name), "from", JSON.stringify(release.release), "updated at", getDateTimeString(release.updated));
  const buffer = release.buffer;
  let info = await checkPathStatus(path.resolve(process.cwd(), options.dir || process.argv[1]));
  if (info.type.file) {
    const stat = await fs.promises.stat(info.path);
    if (
      !options.force &&
      info.name !== "node-deploy.cjs" &&
      stat.size !== 0 &&
      (stat.size < 40000 || stat.size > 120000)
    ) {
      throw new Error(
        `Specified file path does not look like a source file at ${info.path} (can be ignored with "--force")`
      );
    }
    return await performUpgrade(info.path, buffer);
  }
  if (info.type.dir) {
    let list = info.children.filter((f) => f.endsWith(".cjs"));
    if (!list.length) {
      list = info.children.filter((f) => f.endsWith(".js"));
    }
    if (!list.length) {
      list = info.children;
    }
    let target = "node-deploy.cjs";
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    target = "node-deploy.js";
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    target = path.basename(process.argv[1]);
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target), buffer);
    }
    const objs = await Promise.all(
      list.map(async (n) => ({
        file: path.resolve(info.path, n),
        stat: await fs.promises.stat(path.resolve(info.path, n)),
      }))
    );
    target = objs
      .sort((a, b) => a.stat.size - b.stat.size)
      .map((p) => p.file)
      .pop();
    if (!target) {
      target = "node-deploy.cjs";
    }
    return await performUpgrade(target, buffer);
  }
  throw new Error("Could not find a script file to upgrade");
}

async function performUpgrade(target, buffer) {
  if (!buffer || !(buffer instanceof Buffer)) {
    throw new Error("Invalid upgrade data");
  }
  console.log("Writing", buffer.byteLength, "bytes", "to", target);
  await fs.promises.writeFile(target, buffer);
}
