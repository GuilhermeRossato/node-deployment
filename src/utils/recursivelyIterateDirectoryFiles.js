import fs from "fs";
import path from "path";

/**
 * @param {string} target
 * @param {(name: string, path: string, stat: fs.Stats, depth: number) => boolean} selectFunc
 * @param {string[]} array
 * @param {number} [depth]
 * @returns
 */
export default async function recursivelyIterateDirectoryFiles(target, selectFunc = () => true, array = [], depth = 0) {
  if (depth > 20) {
    return array;
  }
  try {
    const stat = await fs.promises.stat(target);
    // Skip filtered
    if (!selectFunc(path.basename(target), target, stat, depth)) {
      return array;
    }
    if (stat.isFile()) {
      if ((target !== "/" && target.endsWith("/")) || target.endsWith("\\")) {
        throw new Error("Invalid folder path for file");
      }
      array.push(target);
      return array;
    }
    const files = await fs.promises.readdir(target);
    for (const file of files) {
      const next = `${
        (target !== "/" && target.endsWith("/")) || target.endsWith("\\")
          ? target.substring(0, target.length - 1)
          : target
      }/${file}`;

      if (array.find((a) => path.resolve(a) === path.resolve(next))) {
        // Skip duplicates
        continue;
      }

      array.push(next);

      await recursivelyIterateDirectoryFiles(next, selectFunc, array, depth + 1);
    }
  } catch (err) {
    //console.log(err);
  }
  return array;
}
