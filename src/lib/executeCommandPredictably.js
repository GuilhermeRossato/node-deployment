import child_process from "child_process";

/**
 * @param {string | string[]} cmd
 * @returns {Promise<{start?: Date, duration?: number, output?: string, error?: Error, exitCode?: number}>}
 */
export function executeCommandPredictably(
  cmd,
  cwd,
  timeoutMs = 0,
  handleOutput
) {
  const debug = false;
  const isArray = cmd instanceof Array;

  /** @type {any} */
  const spawnConfig = {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: !isArray,
  };

  debug && console.log(">", { cmd });

  return new Promise((resolve) => {
    const response = {};
    const chunks = [];
    let timer = null;
    try {
      const child = isArray
        ? child_process.spawn(cmd[0], cmd.slice(1), spawnConfig)
        : child_process.spawn(cmd, spawnConfig);

      const onTimeout = () => {
        timer = null;
        if (!response.error && !response.start) {
          response.error = new Error(`Child timeout without spawn time`);
        } else if (!response.error && response.start) {
          response.error = new Error(
            `Child timeout after ${
              new Date().getTime() - response.start.getTime()
            } ms since spawn time`
          );
        }
        debug && console.log("Child finished:", response);
        resolve(response);
      };

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(onTimeout, timeoutMs);
      }

      child.on("spawn", () => {
        response.start = new Date();
      });

      child.on("error", (err) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (!response.error) {
          response.error = err;
        }
        if (response.start) {
          response.duration =
            (new Date().getTime() - response.start.getTime()) / 1000;
        }
        debug && console.log("Child finished:", response);
        resolve(response);
      });

      child.on("exit", (code) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (response.start) {
          response.duration =
            (new Date().getTime() - response.start.getTime()) / 1000;
        }
        response.exitCode = code;
        if (chunks.length) {
          response.output = Buffer.concat(chunks).toString("utf-8").trim();
        }
        if (!response.error && code !== 0) {
          response.error = new Error(`Program exited with code ${code}`);
        }
        debug && console.log("Child finished:", response);
        resolve(response);
      });

      child.stdout.on("data", (data) =>
        handleOutput ? handleOutput(data.toString("utf-8")) : chunks.push(data)
      );
      child.stderr.on("data", (data) =>
        handleOutput ? handleOutput(data.toString("utf-8")) : chunks.push(data)
      );
    } catch (err) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!response.error) {
        response.error = err;
      }
      if (chunks.length) {
        response.output = Buffer.concat(chunks).toString("utf-8").trim();
      }
      resolve(response);
    }
  });
}
