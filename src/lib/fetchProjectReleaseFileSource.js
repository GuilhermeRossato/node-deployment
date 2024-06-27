import getDateTimeString from "../utils/getDateTimeString.js";

export default async function fetchProjectReleaseFileSource() {
  const authorName = "GuilhermeRossato";
  const projectName = "node-deployment";
  const fileName = "node-deploy.cjs";
  const res = await fetchProjectReleaseFileSourceRaw(authorName, projectName, fileName);
  if (!res||!res.release||!res.buffer) {
    throw new Error('Failed to fetch project release source file');
  }
  const prefix = Buffer.from(
    [
      `// Node Deployment Manager ${res.release} - https://github.com/${authorName}/${projectName}`,
      `// File "${res.name}" downloaded at ${new Date().toISOString()} from ${res.url}`,
      `// Release created at ${getDateTimeString(res.created)} and updated at ${getDateTimeString(res.updated)}\n\n`,
    ].join("\n")
  );
  res.buffer = Buffer.concat([prefix, res.buffer]);
  return res;
}

/**
 * Fetch the release source file code from the repository url using Github API
 */
export async function fetchProjectReleaseFileSourceRaw(
  authorName = "GuilhermeRossato",
  projectName = "node-deployment",
  fileName = "node-deploy.cjs"
) {
  const api = `https://api.github.com/repos/${authorName}/${projectName}`;
  const res = await fetch(`${api}/releases`, {
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const list = await res.json();
  if (list instanceof Array && list.length) {
    for (let i = 0; i < list.length; i++) {
      for (const asset of list[i].assets) {
        if (asset.name === fileName) {
          const url = asset.browser_download_url;
          const r = await fetch(url, {
            headers: {
              "X-GitHub-Api-Version": "2022-11-28",
              Accept: "*/*",
            },
          });
          const blob = await r.blob();
          const array = await blob.arrayBuffer();
          return {
            name: asset.name,
            buffer: Buffer.from(array),
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
