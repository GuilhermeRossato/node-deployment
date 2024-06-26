import fs from "node:fs";
import path from "node:path";
import { checkPathStatus } from "../utils/checkPathStatus.js";
import fetchProjectReleaseFileSource from "../lib/fetchProjectReleaseFileSource.js";

/**
 * @type {import("../lib/getProgramArgs.js").InitModeMethod}
 */
export async function initUpgrade(options) {
  const release = await fetchProjectReleaseFileSource();
  const buffer = release?.buffer;
  const info = await checkPathStatus(path.resolve(process.cwd(), options.dir || process.argv[1]));
  if (info.type.file) {
    const stat = await fs.promises.stat(info.path);
    if (info.name !== "node-deploy.cjs" && stat.size !== 0 && (stat.size < 40000 || stat.size > 120000)) {
      throw new Error(`Specified file path does not look like a source file at ${info.path}`);
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
