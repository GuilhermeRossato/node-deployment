import fs from "fs";
import path from "path";

export default async function recursivelyIterateFiles(
  target,
  selectFunc = (target, stat) => true,
  list = [],
  depth = 0
) {
  //const files = await recursivelyIterateFiles('.', (p, stat) => !['node_modules', '.git'].includes(path.basename(p)) && (stat.isDirectory() || p.endsWith('.js')));
  if (depth > 10) {
    return list;
  }
  try {
    const stat = await fs.promises.stat(target);
    if (stat.isFile()) {
      list.push(target);
      return list;
    }
    const files = await fs.promises.readdir(target);
    for (const file of files) {
      const next = path.resolve(target, file);
      if (selectFunc(target, stat) && !list.includes(target)) {
        await recursivelyIterateFiles(next, selectFunc, list, depth + 1);
      }
    }
  } catch (err) {
    console.log(err);
  }
  return list;
}
