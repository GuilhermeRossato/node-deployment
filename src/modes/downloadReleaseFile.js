
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
              `// Asset file "${asset.name}" downloaded at ${new Date().toISOString()} from ${url}`,
              `// File created at ${asset.created_at} and updated at ${asset.updated_at.replace(
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
