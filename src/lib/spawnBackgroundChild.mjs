import child_process from "child_process";
import { getDebugLog } from "./getDebugLog.mjs";

const debug = false;

export async function spawnBackgroundChild(
  cmd = "node",
  args = [],
  cwd = process.cwd(),
  detached = true
) {
  const debugLog = getDebugLog(debug);

  return await new Promise((resolve, reject) => {
    debugLog(
      "Starting",
      detached ? "detached" : "attached",
      "child:",
      cmd,
      args
    );
    const child = child_process.spawn(cmd, args, {
      cwd,
      detached,
      stdio: detached ? "ignore" : ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    debugLog("Child pid:", pid);
    if (detached) {
      child.unref();
      resolve();
      return;
    }
    const output = (data) => process.stdout.write(data.toString("utf-8"));
    child.stdout && child.stdout.on("data", output);
    child.stderr && child.stderr.on("data", output);
    child.on("spawn", () => {
      debugLog("Child spawned");
    });
    child.on("exit", (code) => {
      debugLog(`Child exited with code: ${code}`);
      if (code === 0) {
        // @ts-ignore
        resolve();
      } else {
        reject(new Error(`Unexpected child exit with code ${code}`));
      }
    });
    child.on("error", (err) => {
      debugLog("Child error:", err);
      reject(err);
    });
  });
}
