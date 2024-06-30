import child_process from "child_process";
import fs from "fs";
import path from "path";

/**
 * @typedef {{
 *   timeout?: number | undefined,
 *   throws?: boolean | Function | undefined,
 *   output?: ((t: string) => void) | false | 'ignore' | true | 'accumulate' | 'inherit' | 'pipe' | 'buffer' | 'raw' | 'binary',
 *   detached?: boolean | undefined,
 *   shell?: boolean | undefined,
 *   debug?: boolean | undefined,
 * }} PredictableExecutionConfig
 */

/**
 * @param {string | string[]} cmd
 * @param {string} [cwd]
 * @param {PredictableExecutionConfig} [config]
 * @returns {Promise<{start?: Date, duration?: number, output?: string | Buffer, error?: Error, exit?: number}>}
 */
export async function executeProcessPredictably(cmd, cwd = ".", config = {}) {
  const timeout =
    typeof config.timeout !== "number" || config.timeout <= 0
      ? 0
      : config.timeout * (config.timeout > 0 && config.timeout < 99 ? 1000 : 1);

  const throws = config.throws;

  const attached = config.detached ? false : true;

  const outputType =
    attached && config.output === "inherit"
      ? "inherit"
      : config.output === false || config.output === "ignore" || !attached
      ? "ignore"
      : config.output === true || config.output === "accumulate"
      ? "buffer"
      : config.output instanceof Function
      ? "function"
      : config.output === "buffer" || config.output === "raw" || config.output === "binary"
      ? "binary"
      : config.output === "pipe" || config.output === "inherit"
      ? "pipe"
      : config.output;

  const shell = (config.shell === undefined && cmd instanceof Array) || config.shell === true;

  const debug = true || config.debug;
  const isArray = cmd instanceof Array;

  debug &&
    console.log(
      "Starting predictable process execution of",
      JSON.stringify(isArray ? cmd[0] : cmd.split(" ").shift()),
      "with args",
      { timeout, throws, output: outputType, attached, shell }
    );

  /**
   * @type {Awaited<ReturnType<executeProcessPredictably>>}
   */
  const response = {};
  /** @type {any} */
  const spawnConfig = {
    cwd: path.resolve(!cwd || cwd === "." ? process.cwd() : cwd),
    stdio: ["ignore", "pipe", "pipe"],
    shell,
  };
  if (!attached) {
    spawnConfig.detached = true;
  }
  if (!attached || outputType === "ignore") {
    spawnConfig.stdio = ["ignore", "ignore", "ignore"];
  } else if (attached && config.output === "inherit") {
    spawnConfig.stdio = ["inherit", "inherit", "inherit"];
  } else if (["function", "pipe", "buffer"].includes(outputType)) {
    spawnConfig.stdio = ["ignore", "pipe", "pipe"];
  }
  try {
    await fs.promises.stat(spawnConfig.cwd);
  } catch (err) {
    debug && console.log("Failed to stat the target working directory:", err);
    response.error = new Error(`Working directory does not exist at "${cwd}"`);
    if (config.throws) {
      throw response.error;
    }
    return response;
  }
  debug && console.log("Process cmd:", cmd);
  debug && console.log("Process working directory:", cwd);
  const chunks = [];
  const type = await new Promise((resolve) => {
    let timer = null;
    try {
      debug &&
        console.log(
          "Spawning",
          JSON.stringify(isArray ? cmd[0] : cmd.split(" ").shift()),
          timeout ? "with timeout" : "without timeout",
          isArray ? "with array argument" : "with string argument"
        );
      const child = isArray
        ? child_process.spawn(cmd[0], cmd.slice(1), spawnConfig)
        : child_process.spawn(cmd, spawnConfig);

      const onTimeout = () => {
        debug &&
          console.log("Timeout elapsed on", response.start ? "spawned" : "unspawned", "child (after", timeout, "ms)");
        timer = null;
        response.error = new Error(`Child timeout (${response.start ? "after spawn" : "not spawned"})`);
        resolve("timeout");
      };

      if (!attached) {
        child.unref();
        resolve("unref");
        return;
      }

      if (timeout && timeout > 0) {
        timer = setTimeout(onTimeout, timeout);
      }

      child.on("error", (err) => {
        debug && console.log("Error event during child spawn:", err);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (!response.error) {
          response.error = err;
        }
        if (response.start) {
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        resolve(response);
        return;
      });

      child.on("spawn", () => {
        response.start = new Date();
        debug && console.log("Child", child.pid, "spawned at", response.start.toISOString());
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
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        debug && console.log("Child finished:", response);
        resolve("error");
        return;
      });

      child.on("exit", (code) => {
        debug && console.log("Child exit:", code);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (response.start) {
          response.duration = (new Date().getTime() - response.start.getTime()) / 1000;
        }
        response.exit = code;
        if (!response.error && code !== 0) {
          response.error = new Error(`Program exited with code ${code}`);
        }
        resolve(code);
      });

      if (outputType !== "ignore" && child.stdout && child.stderr) {
        const handleOutput = (data) => {
          if (outputType === "buffer") {
            chunks.push(data);
          } else if (outputType === "function") {
          }
        };
      }

      const handleOutput =
        outputType === "function" || outputType === "pipe"
          ? config.output instanceof Function
            ? config.output
            : (t) => process.stdout.write(t)
          : null;

      if (child.stdout && child.stdout.on) {
        child.stdout.on("data", (data) =>
          handleOutput ? handleOutput(outputType === "binary" ? data : data.toString("utf-8")) : chunks.push(data)
        );
      }
      if (child.stderr && child.stderr.on) {
        child.stderr.on("data", (data) =>
          handleOutput ? handleOutput(outputType === "binary" ? data : data.toString("utf-8")) : chunks.push(data)
        );
      }
    } catch (err) {
      debug && console.log("Exception during spawn:", err);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!response.error) {
        response.error = err;
      }
      resolve(response);
    }
  });
  debug && console.log("Process finished type:", type);
  debug && console.log("Process handling response:", response);
  if (chunks.length) {
    response.output = outputType === "binary" ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf-8");
  }
  if (response.error && config.throws) {
    throw response.error;
  }
  return response;
}
