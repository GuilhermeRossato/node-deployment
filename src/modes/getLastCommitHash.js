import asyncTryCatchNull from "../lib/asyncTryCatchNull.js";
import { executeCommandPredictably } from "../lib/executeCommandPredictably.js";

export default async function getLastCommitHashSafe(targetPath) {
  return await asyncTryCatchNull(getLastCommitHashUnsafe(targetPath));
}

export async function getLastCommitHashUnsafe(targetPath) {
  const result = await executeCommandPredictably(
    "git log -1",
    targetPath,
    2000
  );
  if (result.exitCode !== 0) {
    throw new Error(`Invalid exit code ${result.exitCode}`);
  }
  const text = result.output.trim();
  if (!text || !text.startsWith('commit ')) {
    throw new Error(`Invalid text prefix ${JSON.stringify(text.substring(0, 16))}`);
  }
  const hash = text.substring(7, text.indexOf(' ', 7));
  if (hash.length === 40 && /^[0-9a-fA-F]{40}$/.test(hash)) {
    return hash;
  }
  throw new Error(`Invalid hash of size ${hash.length} ${JSON.stringify(hash.substring(0, 40))}`);
}
