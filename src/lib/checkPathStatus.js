import fs from "node:fs";
import path from "node:path";

export async function checkPathStatus(target) {
  const result = {
    path: path.resolve(...(target instanceof Array ? target : [target])).replace(/\\/g, '/'),
    name: path.basename(target instanceof Array ? target[target.length-1] : target),
    exists: false,
    type: { file: false, dir: false, bare: false, project: false, initialized: false },
    children: null,
    parent: null,
  };
  try {
    await fs.promises.stat(path.dirname(target));
    result.parent = path.dirname(target).replace(/\\/g, '/');
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
      if (result.type.bare && result.children.includes('refs') && result.children.includes(process.env.DEPLOYMENT_FOLDER_NAME || 'deployment')) {
        const dep = await checkPathStatus([result.path, process.env.DEPLOYMENT_FOLDER_NAME || 'deployment']);
        result.type.initialized = dep.exists && dep.type.dir && dep.children.includes('node-deploy.cjs') && dep.children.includes('.env');
      }
    }
  } catch (err) {
    console.log(err);
    result.type.project = false;
    result.type.bare = false;
  }
  return result;
}
