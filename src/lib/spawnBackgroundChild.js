import child_process from "child_process";

export async function spawnBackgroundChild(
  cmd = "node",
  args = [],
  cwd = process.cwd(),
  detached = true
) {
  return await new Promise((resolve, reject) => {
    console.log(
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
    console.log("Child pid:", pid);
    if (detached) {
      child.unref();
      resolve();
      return;
    }
    const output = (data) => process.stdout.write(data.toString("utf-8"));
    child.stdout && child.stdout.on("data", output);
    child.stderr && child.stderr.on("data", output);
    child.on("spawn", () => {
      console.log("Child spawned");
    });
    child.on("exit", (code) => {
      console.log(`Child exited with code: ${code}`);
      if (code === 0) {
        // @ts-ignore
        resolve();
      } else {
        reject(new Error(`Unexpected child exit with code ${code}`));
      }
    });
    child.on("error", (err) => {
      console.log("Child error:", err);
      reject(err);
    });
  });
}
