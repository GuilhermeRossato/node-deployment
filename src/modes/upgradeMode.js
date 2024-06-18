import fs from "node:fs";
import path from "node:path";
import { checkPathStatus } from "../lib/checkPathStatus.js";

export async function downloadReleaseFile() {
  const repo = `https://api.github.com/repos/GuilhermeRossato/node-deployment`;
  const r = await fetch(`${repo}/releases`, {
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const list = await r.json();
  if (list instanceof Array && list.length) {
    for (let i = 0; i < list.length; i++) {
      for (const asset of list[i].assets) {
        if (asset.name === "node-deploy.cjs") {
          const url = asset.browser_download_url;
          const r = await fetch(url, {
            headers: {
              "X-GitHub-Api-Version": "2022-11-28",
              Accept: "*/*",
            },
          });
          const blob = await r.blob();
          const array = await blob.arrayBuffer();
          const prefix = Buffer.from(
            [
              `// Node Deployment Manager ${list[i].tag_name} - https://github.com/GuilhermeRossato/node-deployment`,
              `// Asset file "${
                asset.name
              }" downloaded at ${new Date().toISOString()} from ${url}`,
              `// File created at ${
                asset.created_at
              } and updated at ${asset.updated_at.replace(
                asset.created_at.substring(0, 11),
                ""
              )}\n\n`,
            ].join("\n")
          );
          const buffer = Buffer.concat([prefix, Buffer.from(array)]);
          return {
            name: asset.name,
            buffer,
            release: list[i].tag_name,
            size: asset.size,
            created: new Date(asset.created_at),
            updated: new Date(asset.updated_at),
            url,
          };
        }
      }
    }
  }
}
export async function initUpgrade(options) {
  const release = await downloadReleaseFile();
  const info = await checkPathStatus(
    path.resolve(process.cwd(), options.dir || process.argv[1])
  );
  if (info.type.file) {
    const stat = await fs.promises.stat(info.path);
    if (
      info.name !== "node-deploy.cjs" &&
      stat.size !== 0 &&
      (stat.size < 40000 || stat.size > 120000)
    ) {
      throw new Error(
        `Specified file path does not look like a source file at ${info.path}`
      );
    }
    return await performUpgrade(info.path, release?.buffer);
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
      return await performUpgrade(path.resolve(info.path, target));
    }
    target = "node-deploy.js";
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target));
    }
    target = path.basename(process.argv[1]);
    if (list.includes(target)) {
      return await performUpgrade(path.resolve(info.path, target));
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
    if (target) {
      return await performUpgrade(target);
    }
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
