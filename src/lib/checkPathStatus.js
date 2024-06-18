import fs from "node:fs";
import path from "node:path";

export async function checkPathStatus(target) {
  const result = {
    path: path.resolve(...(target instanceof Array ? target : [target])),
    name: path.basename(target),
    exists: false,
    type: { file: false, dir: false, bare: false, project: false },
    children: null,
    parent: null,
  };
  try {
    await fs.promises.stat(path.dirname(target));
    result.parent = path.dirname(target);
    const stat = await fs.promises.stat(target);
    result.type.dir = stat.isDirectory && stat.isDirectory();
    result.type.file = stat.isFile && stat.isFile();
    result.exists = true;
    result.children = result.type.dir
      ? await fs.promises.readdir(target)
      : null;
  } catch (err) {
    result.exists = false;
  }
  try {
    const children = result.children || [];

    result.type.project =
      children.includes("package.json") || children.includes("index.js");
    if (children.includes("HEAD") &&
      children.includes("hooks") &&
      children.includes("config")) {
      const config = await fs.promises.readFile(
        path.resolve(target, "config"),
        "utf-8"
      );
      result.type.bare = config.replace(/\s/g, "").includes("bare=true");
    }
  } catch (err) {
    console.log(err);
    result.type.project = false;
    result.type.bare = false;
  }
  return result;
}
