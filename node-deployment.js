// Node Deployment Script v1.0.0

// https://github.com/GuilhermeRossato/node-deployment

// This script handles the CI/CD process for self-hosted node projects.
// It contains an interactive setup to initialize the project

// It works by using the 'post-update' git hook to trigger deployment
// It also maintains the app process, restarting it when needed
// The default deployment steps are `npm ci`, `npm run build`
// When successfull the app is started with `npm run start`.

const process = require("process");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const args = process.argv.slice(2).filter((a) => a !== "--verbose");
const isVerbose = args.length + 2 !== process.argv.length;
const isScheduler = args[0] === "--scheduler" && args.length === 3;
const isManager = args[0] === "--manager" && args.length === 2;
const isProcessor = args[0] === "--processor" && args.length === 2;
const isSetup = args.length === 0 || args.length === 1;

/**
 * Object to persistent log
 */
const c = {
  logFilePath: path.resolve(process.cwd(), "deployment.log"),
  lastFailFilePath: null,
  prefix: isScheduler
    ? " [sh]"
    : isProcessor
    ? " [pro]"
    : isManager
    ? " [mana]"
    : " [s]",
  log: (...args) => {
    const prefix = `[${getDateStringConfigAware(new Date())}]${c.prefix} `;
    const parts = args.map((arg) =>
      arg instanceof Error
        ? arg.stack
        : typeof arg === "string"
        ? arg
            .split("\n")
            .map((line) => prefix + line)
            .join("\n")
        : arg.toString()
    );
    const message = `${parts.join(" ")}\n`;
    if (process.stdout && process.stdout.write) {
      process.stdout.write(message);
    }
    const logFilePath = c.logFilePath;
    if (!logFilePath) {
      return;
    }
    fs.promises.appendFile(logFilePath, message, "utf-8").catch((err) => {
      if (c.lastFailFilePath && logFilePath === c.lastFailFilePath) {
        return;
      }
      c.lastFailFilePath = logFilePath;
      console.log(
        `\nFailed while storing logs at "${logFilePath}": ${err.message}\n`
      );
    });
  },
  vlog: (...args) => (isVerbose ? c.log("[verbose]", ...args) : null),
};

if (isSetup) {
  executeProgramAs(nodeDeploymentSetup, "Setup");
} else if (isManager) {
  executeProgramAs(nodeDeploymentManager, "Instance Manager");
} else if (isProcessor) {
  executeProgramAs(nodeDeploymentProcessor, "Deployment Processor");
} else if (isScheduler) {
  executeProgramAs(nodeDeploymentPostUpdate, "Post Update");
} else {
  if (args.length === 2) {
    c.log(
      `Fatal error: Unhandled arguments supplied to node deployment script: ${args.length}`
    );
  } else {
    c.log(
      `Fatal error: Unhandled arguments supplied to node deployment script: unknown script type at first argument`
    );
  }
  process.exit(1);
}

async function nodeDeploymentManager() {
  if (!args[1]) {
    c.log(
      "Node Deployment Process Manager does not have a project path as argument"
    );
    throw new Error("Missing project target path");
  }
  if (args[1] !== process.cwd()) {
    c.log(`Node Deployment Process Manager target project mismatch`);
    c.log(`Manager started at "${process.cwd()}"`);
    c.log(` First argument is "${args[1]}"`);
    throw new Error("Unmatching project target path");
  }
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(
    fs.promises.stat(path.resolve(projectPath, "deployment"))
  );
  if (deploymentStat === null) {
    throw new Error(
      `Could not find project deployment folder for "${projectPath}"`
    );
  }
  c.logFilePath = path.resolve(projectPath, "deployment", "deployment.log");
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(
      `Could not load project configuration file for "${projectPath}"`
    );
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  if (!config.managerPort) {
    throw new Error(
      "Setup incomplete: Missing instance manager port on config"
    );
  }
  c.log(`Instance manager started for "${projectPath}" at pid ${process.pid}`);
  c.log("");

  // verify if there is a instance manager running
  {
    const pidFilePath = path.resolve(projectPath, "deployment", "manager.pid");
    const pidText = await asyncTryCatchNull(
      fs.promises.readFile(pidFilePath, "utf-8")
    );
    if (pidText && typeof pidText === "string") {
      if (await isProcessRunningByPid(parseInt(pidText.trim()))) {
        c.log(
          `Instance manager started and a deployment processor is already running at pid ${pidText.trim()}`
        );
        c.log(
          `Attempting to stop outdated deployment processor with pid ${pidText.trim()}`
        );
        process.kill(parseInt(pidText.trim()));
        let success = false;
        for (let i = 0; i < 10; i++) {
          await sleep(i === 0 ? 100 : 200);
          if (!(await isProcessRunningByPid(parseInt(pidText.trim())))) {
            success = true;
            break;
          }
        }
        if (success) {
          c.log(
            `Successfully stopped outdated deployment processor with pid ${pidText.trim()}`
          );
        } else {
          c.log(
            "Instance manager could not stop outdated deployment processor"
          );
          c.log(
            "This may stop the new deployment processor server from starting"
          );
          await sleep(1000);
        }
      }
    }
  }

  c.log("Instance manager is starting deployment processor in attached mode");

  let processorRestartCount = 0;
  let processorChild;
  await startDeploymentProcessor();

  process.on("exit", () => {
    try {
      if (processorChild && processorChild.kill) {
        processorChild.kill();
      }
    } catch (err) {
      // ignore
    }
  });

  process.on("beforeExit", () => {
    try {
      if (processorChild && processorChild.kill) {
        processorChild.kill();
      }
    } catch (err) {
      // ignore
    }
  });

  async function startDeploymentProcessor() {
    processorChild = await new Promise((resolve) => {
      try {
        const timer = setTimeout(() => {
          c.log(`Deployment processor failed to start due to spawn timeout`);
          resolve(
            new Error("Timeout exceeded while starting deployment processor")
          );
        }, 3000);
        const command = [
          process.argv[0],
          "./deployment/node-deployment.js",
          "--processor",
          projectPath,
        ];
        const processor = cp.spawn(command[0], command.slice(1), {
          cwd: projectPath,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        processor.stderr.on("data", (data) => {
          const text = data.toString();
          if (processorRestartCount > -7 && text.trim().length) {
            console.log(
              `Deployment processor sent data to instance manager on stderr:\n${text}`
            );
          }
        });
        processor.stdout.on("data", (data) => {
          const text = data.toString();
          if (processorRestartCount > -7 && text.trim().length) {
            console.log(
              `Deployment processor sent data to instance manager:\n${text}`
            );
          }
        });
        let hasExited = false;
        let processorStartTime = null;
        processor.on("spawn", () => {
          processorStartTime = new Date();
          clearTimeout(timer);
          c.log(
            `Instance manager started deployment processor at pid ${processor.pid}`
          );
          // delay resolve to make sure it doesn't exit right away
          setTimeout(() => {
            if (!hasExited) {
              resolve(processor);
            }
          }, 2000);
        });
        processor.on("error", (err) => {
          hasExited = true;
          clearTimeout(timer);
          c.log(
            `Deployment processor failed to start due to error: ${err.message}`
          );
          resolve(err);
        });
        processor.on("exit", (code) => {
          hasExited = true;
          c.log(`Deployment processor exited with code ${code}`);
          if (processorRestartCount === 0) {
            processorRestartCount++;
            c.log(
              `Attempting to restart deployment processor for the first time`
            );
            setTimeout(() => {
              startDeploymentProcessor();
            }, 1000);
          } else if (processorRestartCount === 1) {
            processorRestartCount++;
            c.log(
              `Attempting to restart deployment processor for the second time`
            );
            setTimeout(() => {
              startDeploymentProcessor();
            }, 5000);
          } else {
            processorRestartCount++;
            let delay = 30;
            // if processor has been executing for longer than 30 seconds we can speed up the restart time
            if (
              processorStartTime &&
              new Date().getTime() - processorStartTime.getTime() >= 30_000
            ) {
              delay = 2;
            }
            c.log(
              `Attempting to restart deployment processor for the ${processorRestartCount} time in ${delay} seconds...`
            );
            setTimeout(() => {
              c.log(`Attempting to start deployment processor after it exited`);
              startDeploymentProcessor();
            }, delay * 1_000);
          }
        });
      } catch (err) {
        c.log(`Error while starting deployment processor: ${err.message}`);
        resolve();
      }
    });
  }

  const instanceFilePath = path.resolve(
    projectPath,
    "deployment",
    "instance-path.txt"
  );
  let instancePath = await asyncTryCatchNull(
    fs.promises.readFile(instanceFilePath, "utf-8")
  );
  let lastInstancePid = null;
  let instance;
  let expectInstanceClose = false;
  let restartTimeout;
  async function executeInstanceRestart(targetInstancePath) {
    if (restartTimeout) {
      clearTimeout(restartTimeout);
      restartTimeout = null;
    }
    const id = path.basename(targetInstancePath);
    const stat = await asyncTryCatchNull(fs.promises.stat(targetInstancePath));
    if (stat === null) {
      c.log(
        `Aborting restart request for "${id}" because target was not found at "${targetInstancePath}"`
      );
      return;
    }
    c.log(
      `Processing ${instance ? "restart" : "start"} of instance for "${id}"`
    );
    const instanceBeingReplaced = instancePath;
    if (instance) {
      const pid =
        instance && typeof instance.pid === "number" ? instance.pid : null;
      if (pid !== lastInstancePid) {
        c.log(
          `Warning: pid from instance object is different from last instance pid variable: ${JSON.stringify(
            { lastInstancePid: lastInstancePid, newInstancePid: pid }
          )}`
        );
      }
      expectInstanceClose = true;
      killStartDate = new Date();
      try {
        instance.kill();
      } catch (err) {
        c.log(`Failed to request previous instance running at ${pid} to exit`);
      }
      for (let i = 0; i < 40; i++) {
        const delay = (new Date().getTime() - killStartDate.getTime()) / 1000;
        if (!instance) {
          if (delay >= 5) {
            c.log(`Instance took ${delay.toFixed(1)} seconds to close`);
          }
          break;
        }
        await sleep(350);
        // after waiting 10 times we verify actively if the process is running
        if (i >= 10 && i % 4 === 0 && pid) {
          // verify if pid is still running
          const isRunning = await isProcessRunningByPid(pid);
          if (!instance) {
            break;
          }
          if (!isRunning) {
            c.log(
              `Warning: Process ${pid} is not running but instance object is not null`
            );
            break;
          }
          if (i <= 14) {
            c.log(
              `Warning: The previous instance is still running at ${pid} and has not exited after ${delay.toFixed(
                1
              )} seconds for "${id}"`
            );
          }
        }
        const oldId = path.basename(instanceBeingReplaced);
        if (i === 20 && instanceBeingReplaced) {
          c.log(
            `Previous instance "${oldId}" still has not exited ${delay.toFixed(
              1
            )} seconds after kill command so that "${id}" can start`
          );
        }
        if (i === 22 && instance && typeof instance.pid === "number") {
          try {
            c.log(`Attempting to stop ${instance.pid} with process.kill()`);
            process.kill(instance.pid);
          } catch (err) {
            c.log(
              `Could not kill instance "${oldId}" by sending process kill to ${instance.pid}`
            );
          }
        } else if (i === 36 && typeof instance.pid === "number") {
          try {
            c.log(`Attempting to stop ${instance.pid} with "kill -9"`);
            cp.execSync(`kill -9 ${instance.pid}`);
          } catch (err) {
            c.log(
              `Could not kill instance "${oldId}" by running "kill -9" command at ${instance.pid}`
            );
          }
        }
      }
      if (instance) {
        c.log(
          `Previous instance at "${instanceBeingReplaced}" failed to exit for "${id}" to start`
        );
        const ppid = await getProcessParentIdByPid(pid);
        c.log(
          `Attempting to kill previous instance from parent pid ${ppid} to start "${id}"`
        );
        try {
          process.kill(ppid);
        } catch (err) {
          console.log(
            "Attempting to kill previous instance parent caused an error: " +
              err.message
          );
        }
        for (let i = 0; i < 10 * 4; i++) {
          if (!instance) {
            break;
          }
          await sleep(250);
        }
        if (!instance) {
          console.log(
            "Previous instance closed after killing the parent process"
          );
        } else {
          console.log(
            `Previous instance at pid ${pid} did not close after trying to kill the parent process at pid ${ppid}`
          );
          return;
        }
      }
      await sleep(100);
    }
    if (instanceBeingReplaced !== instancePath) {
      c.log(
        `Aborting restart request for "${id}" because a newer version started ("${process.basename(
          instancePath
        )}")`
      );
      return;
    }
    instancePath = targetInstancePath;

    await sleep(100);
    const instancePidPath = path.resolve(
      projectPath,
      "deployment",
      "instance.pid"
    );
    const instanceLogPath = path.resolve(targetInstancePath, "instance.log");
    /*
    await fs.promises.writeFile(
      instanceLogPath,
      `Process started at ${getDateStringConfigAware(new Date())}\n`,
      "utf-8"
    );
    */

    await sleep(100);

    if (instance !== null && instance !== undefined) {
      c.log(`Previous instance is still running, attempting to stop it again`);
      expectInstanceClose = true;
      instance.kill();
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        if (instance === null || instance === undefined) {
          break;
        }
      }
      if (instance !== null && instance !== undefined) {
        c.log(
          `Restart request for "${id}" failed because previous instance could not be stopped`
        );
        if (instance && instance.pid) {
          c.log(`The instance that caused this has process id ${instance.pid}`);
        } else {
          c.log(`The instance that caused this has no process id`);
        }
        return;
      }
    }
    if (instancePath !== targetInstancePath) {
      c.log(
        `Aborting restart request for "${id}" because the instance path was changed before starting.`
      );
      c.log(
        `The path changed to "${instancePath}" while it was supposed to be "${targetInstancePath}"`
      );
      return;
    }
    const writeError = await asyncTryCatchNull(
      fs.promises.writeFile(instanceFilePath, targetInstancePath, "utf-8")
    );
    if (writeError instanceof Error) {
      c.log(
        `Restart request failed for "${id}" while writing to "${instanceFilePath}": ${writeError.message}`
      );
      return;
    }
    const startTime = new Date();
    expectInstanceClose = false;
    instance = cp.spawn("npm", ["run", "start"], {
      cwd: targetInstancePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (instance && instance.pid) {
      lastInstancePid = instance.pid;
    }
    instance.on("error", (err) => {
      c.log(`Instance from "${id}" failed to start: ${err.message}`);
      instance = null;
    });
    instance.on("exit", (code) => {
      instance = null;
      if (restartTimeout) {
        clearTimeout(restartTimeout);
      }
      const period = (new Date().getTime() - startTime.getTime()) / 1000;
      const timeString =
        period < 60
          ? `${period.toFixed(1)} seconds`
          : period / 60 < 60
          ? `${(period / 60).toFixed(1)} minutes`
          : `${(period / 60).toFixed(1)} hours`;
      c.log(
        `Instance from "${id}" exited ${
          expectInstanceClose ? "expectedly" : "unexpectedly"
        } with code ${JSON.stringify(code)} after running for ${timeString}`
      );
      if (!expectInstanceClose && period > 30) {
        c.log(
          `Restarting instance at "${id}" in 5 seconds as it ran for more than 30 seconds`
        );
        restartTimeout = setTimeout(() => {
          restartTimeout = null;
          c.log(
            `Performing restart of instance "${id}" after timeout caused by exit`
          );
          executeInstanceRestart(targetInstancePath);
        }, 5_000);
      } else if (!expectInstanceClose) {
        c.log(
          `Instance process failed early and executed for less than 30 seconds (${period.toFixed(
            1
          )} s)`
        );
        c.log(
          `Waiting 15 seconds before restarting early exited instance "${id}"`
        );
        restartTimeout = setTimeout(() => {
          restartTimeout = null;
          c.log(
            `Performing restart of instance "${id}" after timeout caused by early exit`
          );
          executeInstanceRestart(targetInstancePath);
        }, 15_000);
      } else if (expectInstanceClose) {
        expectInstanceClose = false;
      }
    });
    instance.on("spawn", () => {
      c.log(`Instance from "${id}" started with pid ${instance.pid}`);
      c.log(`Instance log path: ${instanceLogPath}`);
      fs.promises.writeFile(instancePidPath, instance.pid.toString(), "utf-8");
    });
    instance.stdout.on("data", (data) =>
      fs.promises.appendFile(instanceLogPath, data)
    );
    instance.stderr.on("data", (data) =>
      fs.promises.appendFile(instanceLogPath, data)
    );
  }

  async function processRestartRequest(data) {
    if (!data || !data.repositoryPath) {
      throw new Error("Invalid input");
    }

    const id = path.basename(data.repositoryPath);

    c.log(`Restart request was received for "${id}"`);

    // verify if the current manager is still the most recent
    const pidFilePath = path.resolve(projectPath, "deployment", "manager.pid");
    const selfPid = await asyncTryCatchNull(
      fs.promises.readFile(pidFilePath, "utf-8")
    );
    if (
      typeof selfPid === "string" &&
      selfPid.trim() !== process.pid.toString().trim()
    ) {
      c.log(
        `Instance manager process ${process.pid} read unexpected instance pid file contents: ${selfPid}`
      );
      c.log(
        `This manager will terminate itself as another seems to have replaced it`
      );
      setTimeout(() => {
        process.exit(1);
      }, 100);
      return;
    }

    executeInstanceRestart(data.repositoryPath).catch((err) => {
      c.log(`Instance restart for "${id}" failed: ${err.stack}`);
    });
  }

  c.log("");
  c.log(
    `Initializing instance manager server at http://localhost:${config.managerPort}/`
  );

  // manager
  let server;
  const httpServerRetryAmount = 8;
  for (let k = 0; k < httpServerRetryAmount; k++) {
    if (k !== 0) {
      c.log(
        `Retrying to start instance manager server again at http://localhost:${config.managerPort}/`
      );
    }
    try {
      server = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) =>
          processHttpServerRequest(
            "Instance Manager",
            processRestartRequest,
            req,
            res
          )
        );
        server.on("error", reject);
        server.listen(config.managerPort, () => {
          resolve(server);
        });
      });
      break;
    } catch (err) {
      if (err && err.code === "EADDRINUSE" && k <= httpServerRetryAmount / 2) {
        c.log(
          `Instance manager detected another server running at ${config.managerPort}`
        );
        c.log(`It will be requested to terminate by sending a HTTP request`);
        try {
          const response = await fetch(
            `http://localhost:${config.managerPort}/kill`,
            { method: "POST" }
          );
          const text = await response.text();
          if (!response.ok || (text !== "ok" && text !== '"ok"')) {
            throw new Error(
              `Unexpected terminate response with status ${
                response.status
              } and body "${text.substring(0, 100)}"`
            );
          }
        } catch (err) {
          c.log(
            `Request to terminate server at ${config.managerPort} failed: ${err.message}`
          );
        }
        await sleep(500);
        continue;
      }
      if (k <= httpServerRetryAmount - 1) {
        c.log(
          `Instance manager failed ${k} out of ${httpServerRetryAmount} times to start server at tcp port ${
            config.managerPort
          }: ${JSON.stringify(err.message)}`
        );
        await sleep(250 + 500 * k);
        continue;
      }
      c.log(
        `Failed ${k} times to start server at tcp port ${config.managerPort}: ${err.message}`
      );
      process.exit(1);
    }
  }

  if (!server) {
    c.log("Instance manager server object is missing");
    process.exit(1);
  }

  const pidFilePath = path.resolve(projectPath, "deployment", "manager.pid");
  c.log(`Writing manager pid at "${pidFilePath}"`);
  await fs.promises.writeFile(pidFilePath, process.pid.toString(), "utf-8");

  if (instancePath) {
    c.log(`Initializing previous instance from "${instancePath}"`);
    try {
      await executeInstanceRestart(instancePath);
    } catch (err) {
      c.log(
        `Instance manager failed to start previous instance: ${err.message}`
      );
    }
  }
}

async function nodeDeploymentProcessor() {
  if (!args[1]) {
    c.log("Node Deployment Processor does not have a project path as argument");
    throw new Error("Missing project target path");
  }
  if (args[1] !== process.cwd()) {
    c.log(`Node Deployment Processor target project mismatch`);
    c.log(`Manager started at "${process.cwd()}"`);
    c.log(` First argument is "${args[1]}"`);
    throw new Error("Unmatching project target path");
  }
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(
    fs.promises.stat(path.resolve(projectPath, "deployment"))
  );
  if (deploymentStat === null) {
    c.log(`Could not find project deployment folder`);
    throw new Error(
      `Could not find project deployment folder for "${projectPath}"`
    );
  }
  c.logFilePath = path.resolve(projectPath, "deployment", "deployment.log");
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(
      `Could not load project configuration file for "${projectPath}"`
    );
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  if (!config.processorPort) {
    throw new Error(
      "Setup incomplete: Missing deployment processor port on config"
    );
  }
  c.log(`Node deployment processor started for "${projectPath}"`);

  let runningPipelineId = null;
  let replacingPipelineId = null;

  async function executeDeployPipeline(id, repositoryPath) {
    c.log(`Processing for "${id}" started`);
    const config = await getProjectConfig(projectPath);
    if (!config || !config.steps || !config.steps.length) {
      throw new Error("Missing config or pipeline steps");
    }
    const isFirstReuse = config.steps[0].id === "reuse";
    const steps = isFirstReuse ? config.steps.slice(1) : config.steps;
    if (
      isFirstReuse &&
      fs.existsSync(path.resolve(repositoryPath, "node_modules"))
    ) {
      c.log(
        `Pipeline "${id}" - Finished Step 0 - Instance folder was initialized from previous`
      );
    }
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (runningPipelineId !== id) {
        c.log(
          `Pipeline "${id}" - Cancelled at step ${
            i + 1
          } because running pipeline id changed to "${runningPipelineId}"`
        );
        break;
      }
      if (replacingPipelineId !== null && replacingPipelineId !== undefined) {
        c.log(
          `Pipeline "${id}" - Cancelled at step ${
            i + 1
          } because replacing pipeline id was set to "${replacingPipelineId}"`
        );
        break;
      }
      c.log(`Pipeline "${id}" - Starting step ${i + 1} - ${step.name}`);
      if (step.id === "purge") {
        const instanceParentDir = path.dirname(repositoryPath);
        const pipelineList = await fs.promises.readdir(instanceParentDir);
        c.log(
          `Purge step found ${pipelineList.length} pipeline folders at "${instanceParentDir}"`
        );
        const exceedList =
          pipelineList.length <= 15
            ? []
            : pipelineList.length <= 16
            ? [pipelineList[0]]
            : [pipelineList[0], pipelineList[1]];
        if (exceedList.length === 0) {
          c.log(
            `Pipeline "${id}" - Skipping step ${
              i + 1
            } because there aren\'t enough pipeline folders to trigger deletion`
          );
        } else {
          let hadError = false;
          for (let j = 0; j < exceedList.length; j++) {
            const pipelinePath = path.resolve(instanceParentDir, exceedList[i]);
            try {
              c.log(`Removing old pipeline folder at "${pipelinePath}"`);
              cp.execSync(`rm -rf "${pipelinePath}"`, {
                cwd: repositoryPath,
                stdio: "inherit",
              });
            } catch (err) {
              hadError = true;
              c.log(
                `Failed at removing old pipeline folder of "${exceedList[i]}": ${err.message}`
              );
            }
          }
          c.log(
            `Pipeline "${id}" - Finished step ${i + 1} ${
              hadError ? "with errors" : ""
            }`
          );
        }
      } else if (step.id === "restart") {
        const response = await fetch(
          `http://localhost:${config.managerPort}/`,
          {
            method: "POST",
            body: JSON.stringify({ repositoryPath }),
          }
        );
        const text = await response.text();
        if (text) {
          console.log(`Instance manager response: ${text}`);
        }
        if (!response.ok) {
          throw new Error("Instance manager responded with error");
        }
        c.log(`Pipeline "${id}" - Finished step ${i + 1}`);
      } else if (step.id === "install") {
        const packageLockStat = await asyncTryCatchNull(
          fs.promises.stat(path.resolve(repositoryPath, "package-lock.json"))
        );
        const statLockStat =
          packageLockStat instanceof fs.Stats
            ? null
            : await asyncTryCatchNull(
                fs.promises.stat(path.resolve(repositoryPath, "yarn.lock"))
              );
        await new Promise((resolve, reject) => {
          let command = step.command.split(" ");
          if (statLockStat instanceof fs.Stats) {
            command = ["yarn"];
          } else if (command[1] === "ci" && !packageLockStat) {
            command[1] = "install";
          }

          c.log(`Pipeline "${id}" - Step ${i + 1} - $ ${command.join(" ")}`);
          const child = cp.spawn(command[0], command.slice(1), {
            cwd: repositoryPath,
            stdio: ["inherit", "pipe", "pipe"],
          });
          child.stdout.on("data", (text) => {
            c.log(text.toString().replace(/\r/g, ""));
          });
          child.stderr.on("data", (text) => {
            c.log(text.toString().replace(/\r/g, ""));
          });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `Install command failed at "${repositoryPath}" with error code ${code}`
                )
              );
            }
          });
        });
        c.log(`Pipeline ${id} - Finished step ${i + 1} without errors`);
      } else if (step.id === "script") {
        await new Promise((resolve, reject) => {
          const command = step.command.split(" ");
          c.log(`Pipeline "${id}" - Step ${i + 1} - $ ${command.join(" ")}`);
          const child = cp.spawn(command[0], command.slice(1), {
            cwd: repositoryPath,
            stdio: ["inherit", "pipe", "pipe"],
          });
          child.stdout.on("data", (text) => {
            c.log(text.toString().replace(/\r/g, ""));
          });
          child.stderr.on("data", (text) => {
            c.log(text.toString().replace(/\r/g, ""));
          });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `Command "${command.join(
                    " "
                  )}" exited with error code ${code}`
                )
              );
            }
          });
        });
        c.log(`Pipeline "${id}" - Finished step ${i + 1}`);
      } else {
        throw new Error(
          `Unknown pipeline step id "${step.id}" at index ${i} of "${projectPath}"`
        );
      }
    }
    if (runningPipelineId === id) {
      runningPipelineId = null;
    }
  }
  async function waitThenProcessPipelineRequest(id, repositoryPath) {
    // verify if the current processor is still the most recentv
    const pidFilePath = path.resolve(
      projectPath,
      "deployment",
      "processor.pid"
    );
    const selfPid = await asyncTryCatchNull(
      fs.promises.readFile(pidFilePath, "utf-8")
    );
    if (
      typeof selfPid !== "string" ||
      selfPid.trim() !== process.pid.toString().trim()
    ) {
      c.log(
        `Fatal error: Deployment processor pid ${
          process.pid
        } detected unexpected instance pid file contents: ${JSON.stringify(
          selfPid
        )}`
      );
      c.log(
        `Deployment processor will terminate because of updated pid file at "${pidFilePath}"`
      );
      setTimeout(() => {
        process.exit(1);
      }, 100);
      return;
    }

    if (runningPipelineId) {
      c.log(`"${id}" will wait for "${runningPipelineId}" to be stopped`);
      replacingPipelineId = id;
      for (let i = 0; i < 600; i++) {
        await sleep(100);
        if (replacingPipelineId !== id) {
          c.log(
            `Pipeline "${id}" was cancelled by the start of "${replacingPipelineId}"`
          );
          return;
        }
        if (runningPipelineId === null) {
          c.log(`The previous pipeline was cancelled and "${id}" will start`);
          return;
        }
      }
    }
    if (runningPipelineId !== null && runningPipelineId !== undefined) {
      c.log(
        `The pipeline "${id}" could not be executed because "${runningPipelineId}" was executing.`
      );
      return;
    }

    replacingPipelineId = null;
    runningPipelineId = id;
    executeDeployPipeline(id, repositoryPath).catch((err) => {
      c.log(`Deployment processing for "${id}" failed: ${err.stack}`);
      runningPipelineId = null;
    });
  }

  async function processPipelineRequest(data) {
    if (!data || !data.repositoryPath) {
      throw new Error("Invalid input");
    }
    const targetInstancePath = data.repositoryPath;
    const id = path.basename(targetInstancePath);
    c.log(
      `Received pipeline request "${id}" (${
        runningPipelineId
          ? `while "${runningPipelineId}" is executing`
          : "while idle"
      })`
    );

    waitThenProcessPipelineRequest(id, targetInstancePath).catch((err) => {
      c.log(`The pipeline initialization for "${id}" failed: ${err.stack}`);
    });
  }

  c.log("");
  c.log(
    `Initializing deployment processor server at http://localhost:${config.processorPort}/`
  );

  // processor
  let server;
  const httpServerRetryAmount = 8;
  for (let k = 0; k < httpServerRetryAmount; k++) {
    if (k !== 0) {
      c.log(
        `Retrying to start deployment processor server again at http://localhost:${config.processorPort}/`
      );
    }
    try {
      server = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) =>
          processHttpServerRequest(
            "Deployment Processor",
            processPipelineRequest,
            req,
            res
          )
        );
        server.on("error", reject);
        server.listen(config.processorPort, () => {
          resolve(server);
        });
      });
      break;
    } catch (err) {
      if (err && err.code === "EADDRINUSE" && k <= httpServerRetryAmount / 2) {
        c.log(
          `Deployment processor detected another server running at ${config.processorPort}`
        );
        c.log(`It will be requested to terminate by sending a HTTP request`);
        try {
          const response = await fetch(
            `http://localhost:${config.processorPort}/kill`,
            { method: "POST" }
          );
          const text = await response.text();
          if (!response.ok || (text !== "ok" && text !== '"ok"')) {
            throw new Error(
              `Unexpected terminate response with status ${
                response.status
              } and body "${text.substring(0, 100)}"`
            );
          }
        } catch (err) {
          c.log(
            `Request to terminate server at ${config.processorPort} failed: ${err.message}`
          );
        }
        await sleep(500);
        continue;
      }
      if (k <= httpServerRetryAmount - 1) {
        c.log(
          `Warning: Deployment processor failed ${k} out of ${httpServerRetryAmount} times to start server at tcp port ${
            config.processorPort
          }: ${JSON.stringify(err.message)}`
        );
        await sleep(250 + 500 * k);
        continue;
      }
      c.log(
        `Failed ${k} times to start server at tcp port ${config.processorPort}: ${err.message}`
      );
      process.exit(1);
    }
  }

  if (!server) {
    c.log("Missing server object on processor");
    process.exit(1);
  }

  const pidFilePath = path.resolve(projectPath, "deployment", "processor.pid");
  c.log(`Writing processor pid at "${pidFilePath}"`);
  await fs.promises.writeFile(pidFilePath, process.pid.toString(), "utf-8");
}

async function nodeDeploymentPostUpdate() {
  const projectPath = path.resolve(args[1]);
  const deploymentStat = await asyncTryCatchNull(
    fs.promises.stat(path.resolve(projectPath, "deployment"))
  );
  if (deploymentStat === null) {
    throw new Error(
      `Could not find project deployment folder for "${projectPath}"`
    );
  }
  c.logFilePath = path.resolve(projectPath, "deployment", "deployment.log");
  const config = await getProjectConfig(projectPath);
  if (!config) {
    throw new Error(
      `Could not load project configuration file for "${projectPath}"`
    );
  }
  if (config.logFilePath) {
    c.logFilePath = config.logFilePath;
  }
  const branchRef = args[2];
  if (config.triggerBranch) {
    if (!branchRef) {
      c.log(`Node deployment post update started without a branch reference`);
      c.log(`Ignoring update as it does not match configured trigger branch`);
      return;
    } else if (!branchRef.endsWith(`/${config.triggerBranch}`)) {
      c.log(`Node deployment post update started for ref "${branchRef}"`);
      c.log("Ignoring update as it does not match configured trigger branch");
      return;
    } else {
      c.log(
        `Node deployment post update started for triggered branch "${config.triggerBranch}"`
      );
    }
  } else {
    c.log(`Node deployment post update started`);
  }
  const id = getCurrentVersionId();
  const repositoryPath = path.resolve(
    projectPath,
    "deployment",
    "versions",
    id
  );
  c.log(`Creating new deployment folder with id "${id}"`);
  await fs.promises.mkdir(repositoryPath, { recursive: true });

  if (
    config.steps.length &&
    config.steps[0] &&
    config.steps[0].id === "reuse"
  ) {
    try {
      const instanceFilePath = path.resolve(
        projectPath,
        "deployment",
        "instance-path.txt"
      );
      const instancePath = await asyncTryCatchNull(
        fs.promises.readFile(instanceFilePath, "utf-8")
      );
      if (instancePath && fs.existsSync(instancePath)) {
        c.log(
          `Copying previous instance folder from "${path.basename(
            instancePath
          )}"`
        );
        const sourceArg = instancePath.endsWith("/")
          ? instancePath.substring(0, instancePath.length - 1)
          : instancePath;
        const targetArg = repositoryPath.endsWith("/")
          ? repositoryPath.substring(0, repositoryPath.length - 1)
          : repositoryPath;
        cp.execSync(`cp -rf "${sourceArg}" "${targetArg}"`, {
          cwd: projectPath,
          stdio: "inherit",
        });
        c.log("Successfully copied instance files to new pipeline folder");
      }
    } catch (err) {
      c.log("Failed to copy previous instance folder to new pipeline folder");
    }
  }
  try {
    c.log(`Executing checkout at "${repositoryPath}"`);
    cp.execSync(`git --work-tree=${repositoryPath} checkout -f`, {
      cwd: projectPath,
      stdio: "inherit",
    });
  } catch (err) {
    c.log(`Post update failed while executing git checkout.`);
    c.log(err.message);
    process.exit(1);
  }
  try {
    c.log(
      `Sending pipeline "${id}" to processor at port ${config.processorPort}`
    );
    async function sendToProcessor() {
      const response = await fetch(
        `http://localhost:${config.processorPort}/`,
        {
          method: "POST",
          body: JSON.stringify({ id, repositoryPath }),
        }
      );
      const text = await response.text();
      if (text) {
        c.log(`Deployment processor response: ${text}`);
      }
      if (!response.ok) {
        throw new Error("Deployment processor responded with error");
      }
    }
    try {
      await sendToProcessor();
    } catch (err) {
      if (!err || err.message !== "fetch failed") {
        throw err;
      }
      const pidFilePath = path.resolve(
        projectPath,
        "deployment",
        "manager.pid"
      );
      const pid = await asyncTryCatchNull(
        fs.promises.readFile(pidFilePath, "utf-8")
      );
      if (!(pid && typeof pid === "string")) {
        c.log(
          "Request to processor failed to connect and instance manager is not running (no pid file)"
        );
        throw err;
      }
      c.log(
        "Request to processor failed to connect, verifying if manager is running..."
      );
      if (await isProcessRunningByPid(pid.trim())) {
        c.log(
          `Manager is running but deployment processor request to port ${config.processorPort} failed to connect`
        );
        throw err;
      }
      c.log("Manager is not running, attempting to start it detached");
      const child = cp.spawn(
        "node",
        ["./deployment/node-deployment.js", "--manager", projectPath],
        {
          cwd: projectPath,
          env: process.env,
          stdio: "ignore",
          detached: true,
        }
      );
      child.unref();
      await sleep(2000);
      c.log(
        "Attempting to send request to processor after starting instance manager process"
      );
      await sendToProcessor();
      c.log(
        `Request to schedule "${id}" worked after starting instance manager process`
      );
      return;
    }
    c.log(`Pipeline ${id} scheduled sucessfully`);
  } catch (err) {
    c.log(
      `Post update failed while sending new pipeline request to deployment processor.`
    );
    c.log(err.stack);
    process.exit(1);
  }
}

function getCurrentVersionId() {
  return getDateStringConfigAware(new Date())
    .replace(" ", "_")
    .replace("T", "_")
    .substring(0, 23)
    .replace(/\:/g, "-")
    .replace(".", "_");
}

function getDateFromVersionId(id, ignoreOffset) {
  if (id.length < 10 || id.length > 30 || !id.includes("_")) {
    return null;
  }
  const n = id.replace(/\D/g, "");
  if (n.length < 14) {
    return null;
  }
  const [yyyy, mm, dd, hh, ii, ss, ms] = [
    n.substring(0, 4),
    n.substring(4, 6),
    n.substring(6, 8),
    n.substring(8, 10),
    n.substring(10, 12),
    n.substring(12, 14),
    n.substring(14),
  ];
  const dateAsUTC = new Date(
    `${yyyy}-${mm}-${dd}T${hh}:${ii}:${ss}${ms ? `.${ms}` : ""}Z`
  );
  if (isNaN(dateAsUTC.getTime())) {
    return null;
  }
  if (!ignoreOffset && global.cachedConfig && global.cachedConfig.hourOffset) {
    dateAsUTC.setTime(
      dateAsUTC.getTime() + global.cachedConfig.hourOffset * 60 * 60 * 1000
    );
  }
  return dateAsUTC;
}

function executeProgramAs(func, role) {
  c.vlog(`Starting node deployment script as "${role}" at pid ${process.pid}`);
  func()
    .then(() => {
      c.vlog(
        `Node deployment script finished as "${role}" at pid ${process.pid}`
      );
      if (role === "Setup") {
        process.exit(0);
      }
    })
    .catch((err) => {
      c.log(
        `Node deployment script failed as "${role}" at pid ${process.pid}:`
      );
      c.log(err.stack);
      process.exit(1);
    });
}

async function waitForUserConfirmation(question) {
  if (question) {
    process.stdout.write(`${question} (y/n) `);
  }
  for (let k = 0; k < 1000; k++) {
    const y = await waitForUserInput();
    if (y === "" || y.toLowerCase()[0] === "y") {
      return true;
    }
    if (y.toLowerCase()[0] === "n") {
      return false;
    }
    process.stdout.write("Unrecognized response.\n");
    process.stdout.write(question ? question : "Do you confirm?");
    process.stdout.write(" (y/n) ");
  }
  return false;
}

async function getProjectConfig(projectPath, forceRefresh = false) {
  if (!projectPath) {
    return null;
  }

  if (!forceRefresh && global.cachedConfig) {
    return global.cachedConfig;
  }

  const configPath = path.resolve(projectPath, "deployment", "config.json");

  const configText = await asyncTryCatchNull(
    fs.promises.readFile(configPath, "utf-8")
  );

  if (!configText) {
    return null;
  }

  global.cachedConfig = JSON.parse(configText);

  return global.cachedConfig;
}

async function evaluateProjectPath(projectPath) {
  const valid =
    typeof projectPath === "string" &&
    projectPath.length >= 1 &&
    !projectPath.includes("..");

  const obj = {
    config: {},
    path: {
      parent: valid ? path.resolve(path.dirname(projectPath)) : "",
      repository: valid ? path.resolve(projectPath) : "",
      hooks: valid ? path.resolve(projectPath, "hooks") : "",
      deployment: valid ? path.resolve(projectPath, "deployment") : "",
      config: valid
        ? path.resolve(projectPath, "deployment", "config.json")
        : "",
    },
    exists: {
      parent: valid ? null : false,
      repository: valid ? null : false,
      hooks: valid ? null : false,
      deployment: valid ? null : false,
      config: valid ? null : false,
    },
  };
  if (!valid) {
    return obj;
  }
  for (const key of ["parent", "repository", "hooks", "deployment", "config"]) {
    try {
      const stat = await asyncTryCatchNull(fs.promises.stat(obj.path[key]));
      obj.exists[key] = stat !== null;
      if (obj.exists[key] === false) {
        return obj;
      }
    } catch (err) {
      c.vlog(
        `Warning: Stat error while evaluating "${obj.path[key]}": ${err.message}`
      );
    }
  }
  if (obj.exists.repository && obj.exists.config) {
    obj.config = await getProjectConfig(obj.path.repository);
  }
  return obj;
}

async function executeNodeDeploymentSetupForProject(projectPath) {
  const ev = await evaluateProjectPath(projectPath);
  // Step 1
  if (!ev.exists.repository) {
    c.log(`Step 1. Creating the project directory`);
    await sleep(500);
    c.log("");
    try {
      await fs.promises.mkdir(ev.path.repository, { recursive: true });
    } catch (err) {
      if (err.code === "EACCES") {
        c.log("Got permission denied while trying to create the target folder");
        c.log("You can create the folder manually and retry the setup");
        c.log("");
      }
      throw err;
    }
    ev.exists.repository = true;
  }
  // Step 2
  if (!ev.exists.hooks) {
    c.log(`Step 2. Creating git bare repository`);
    await sleep(500);
    c.log("");
    cp.execSync("git init --bare", {
      cwd: ev.path.repository,
      stdio: ["ignore", "inherit", "inherit"],
    });
    process.stdout.write("\n");
    ev.exists.hooks = true;
  }
  // Step 3
  if (!ev.exists.deployment) {
    c.log(`Step 3. Creating the deployment folder`);
    await sleep(500);
    c.log("");
    await fs.promises.mkdir(ev.path.deployment, { recursive: true });
    ev.exists.deployment = true;
    const oldLogFilePath = c.logFilePath;
    const newLogFilePath = path.resolve(ev.path.deployment, "deployment.log");
    c.log(`Continuing logs to new path at "${newLogFilePath}"`);
    try {
      await fs.promises.copyFile(oldLogFilePath, newLogFilePath);
    } catch (err) {
      // Ignore copy failure
    }
    c.logFilePath = newLogFilePath;
    c.log(`Continuing logs from old path at "${oldLogFilePath}"`);
    c.log("");
  } else {
    c.logFilePath = path.resolve(ev.path.deployment, "deployment.log");
  }
  // Step 4
  {
    const targetScriptPath = path.resolve(
      ev.path.deployment,
      "node-deployment.js"
    );
    const targetScriptSource = await asyncTryCatchNull(
      fs.promises.readFile(targetScriptPath, "utf-8")
    );
    if (targetScriptSource === null) {
      c.log(
        `Step 4. Adding the node deployment script to the deployment folder`
      );
      await sleep(500);
      c.log("");
    }
    const originScriptPath = path.resolve(process.cwd(), process.argv[1]);
    const originScriptSource = await asyncTryCatchNull(
      fs.promises.readFile(originScriptPath, "utf-8")
    );
    if (originScriptSource === null) {
      if (targetScriptSource === null) {
        throw new Error(
          `Could not load the contents of the current script from "${originScriptPath}" to write to "${targetScriptPath}"`
        );
      } else {
        c.log(
          `The current executing script was not found at "${originScriptPath}"`
        );
        c.log(
          `The verification of the project script was skipped as it already exists`
        );
      }
    } else {
      if (targetScriptSource === null) {
        await fs.promises.writeFile(
          targetScriptPath,
          originScriptSource,
          "utf-8"
        );
        c.log(`Created the script at "${targetScriptPath}"`);
        c.log("");
      } else if (targetScriptSource.trim() !== originScriptSource.trim()) {
        c.log(
          `The deployment script configured on the project might be outdated`
        );
        c.log(`The source code does not match the currently executing script`);
        c.log("");
        c.log(` project script path: ${targetScriptPath}`);
        c.log(
          ` project script size: ${(targetScriptSource.length / 1024).toFixed(
            1
          )} kB`
        );
        c.log(`    this script path: ${originScriptPath}`);
        c.log(
          `    this script size: ${(originScriptSource.length / 1024).toFixed(
            1
          )} kB`
        );
        c.log("");
        c.log(
          "Do you want to replace the script at the project with this one?"
        );
        process.stdout.write("\n");
        const confirm = await waitForUserConfirmation(
          " > Replace deployment script of project?"
        );
        process.stdout.write("\n");
        if (confirm) {
          await fs.promises.writeFile(
            targetScriptPath,
            originScriptSource,
            "utf-8"
          );
          c.log(
            `Sucessfully updated the source code content of "${targetScriptPath}"`
          );
          c.log("");
        }
      }
    }
  }
  // Step 5
  const saveConfig = () =>
    fs.promises.writeFile(
      ev.path.config,
      JSON.stringify(ev.config, null, "  "),
      "utf-8"
    );
  if (!ev.exists.config) {
    c.log(`Step 5. Adding the configuration file to the deployment folder`);
    await sleep(500);
    c.log("");
    const [instanceManagerPort, deploymentProcessorPort] = await Promise.all(
      [0, 200].map(
        (delay) =>
          new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => res.end(""));
            server.on("listening", () => {
              try {
                const port = server.address().port;
                setTimeout(() => {
                  server.close();
                  resolve(port);
                }, 400);
              } catch (err) {
                reject(err);
              }
            });
            server.on("error", reject);
            setTimeout(() => server.listen(), delay);
          })
      )
    );
    ev.config = {
      logFilePath: path.resolve(ev.path.deployment, "deployment.log"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      managerPort: instanceManagerPort,
      processorPort: deploymentProcessorPort,
      steps: getStartingPipelineSteps(),
    };
    c.log(`Configured port for instance manager: ${instanceManagerPort}`);
    c.log(
      `Configured port for deployment processor: ${deploymentProcessorPort}`
    );
    c.log("");
    await saveConfig();
  }
  // Step 6
  const postUpdateHookPath = path.resolve(ev.path.hooks, "post-update");
  {
    const postUpdateSource = `#!/bin/bash\n/bin/node ./deployment/node-deployment.js --scheduler "${ev.path.repository}" \$*\n`;
    const postUpdateContent = await asyncTryCatchNull(
      fs.promises.readFile(postUpdateHookPath, "utf-8")
    );
    if (postUpdateContent === null) {
      c.log("Step 6. Adding the post-update hook to the repository");
      await sleep(500);
      await fs.promises.writeFile(
        postUpdateHookPath,
        `${postUpdateSource}# do not edit above this command because node-deployment uses it\n`,
        "utf-8"
      );
    } else if (!postUpdateContent.startsWith(postUpdateSource)) {
      c.log('The "post-update" git hook has an invalid content');
      c.log("This script will update it to be correct");
      await fs.promises.writeFile(
        postUpdateHookPath,
        `${postUpdateSource}# do not edit above this command because node-deployment uses it\n`,
        "utf-8"
      );
      c.log("");
    }
  }

  // Step 7
  if (!ev.config.madePostUpdateExecutable) {
    c.log("Step 7. Making the post-update script executable by git");
    await sleep(500);
    cp.execSync(`chmod +x "${postUpdateHookPath}"`, {
      cwd: ev.path.hooks,
      stdio: "inherit",
    });
    ev.config.madePostUpdateExecutable = true;
    await saveConfig();
  }
  // Step 8
  {
    // Verify if the instance manager is running
    let instanceManagerPidText = await asyncTryCatchNull(
      fs.promises.readFile(
        path.resolve(ev.path.deployment, "manager.pid"),
        "utf-8"
      )
    );
    let willStartManager = false;
    if (!willStartManager && instanceManagerPidText === null) {
      c.log("Step 8. Starting Instance Manager");
      await sleep(500);
      c.log("");
      willStartManager = true;
    }
    if (!willStartManager && instanceManagerPidText) {
      const running = await isProcessRunningByPid(
        parseInt(instanceManagerPidText, 10)
      );
      if (!running) {
        willStartManager = true;
        c.log("The instance manager process is not executing");
        c.log("Starting it so that the app instance can be handled");
        c.log("");
      }
    }
    if (willStartManager) {
      const command = [
        process.argv[0],
        "./deployment/node-deployment.js",
        "--manager",
        ev.path.repository,
      ];
      for (let t = 1; t < 2; t++) {
        if (t !== 0) {
          await sleep(200);
        }
        c.log(
          `Executing instance manager ${
            t === 0 ? "in attached mode" : "in detached mode"
          } from setup script`
        );
        await sleep(200);
        c.log("");
        await new Promise((resolve, reject) => {
          const child = cp.spawn(command[0], command.slice(1), {
            cwd: ev.path.repository,
            env: process.env,
            stdio: t === 0 ? ["ignore", "pipe", "pipe"] : "ignore",
            detached: t === 0 ? false : true,
          });
          if (t === 1) {
            child.unref();
            resolve();
            return;
          }
          let hasSpawned = false;
          let wasKilled = false;
          let timeout = setTimeout(() => {
            if (!hasSpawned) {
              reject(
                new Error("Node deployment instance manager spawn timeout")
              );
              return;
            }
            try {
              wasKilled = true;
              child.kill();
            } catch (err) {
              // ignore
            }
          }, 3500);
          child.on("spawn", () => {
            hasSpawned = true;
            c.log(
              `Node deployment instance manager spawned in attached mode at pid ${child.pid}`
            );
          });
          child.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
          child.on("exit", (code) => {
            if (wasKilled) {
              c.log(
                "Instance manager process stopped expectedly in attached mode"
              );
              resolve();
            } else {
              reject(
                new Error(
                  `Node deployment instance manager exited with code ${code} unexpectedly`
                )
              );
            }
          });
          child.stdout.on("data", (data) => process.stdout.write(data));
          child.stderr.on("data", (data) => process.stderr.write(data));
        });
        await sleep(500);
      }
      await sleep(250);
      c.log("Checking instance manager process");
      const maxTries = 10;
      for (let k = 0; k <= maxTries; k++) {
        await sleep(250);
        const managerPidPath = path.resolve(ev.path.deployment, "manager.pid");
        instanceManagerPidText = await asyncTryCatchNull(
          fs.promises.readFile(managerPidPath, "utf-8")
        );
        if (instanceManagerPidText === null) {
          if (k === Math.floor(maxTries / 2)) {
            c.log(
              `Instance manager did not write to the manager pid file at "${managerPidPath}"`
            );
          }
          if (k < maxTries) {
            continue;
          }
          throw new Error(
            `Instance manager did not start because the pid file at "${managerPidPath}" does not exist`
          );
        }
        if (instanceManagerPidText instanceof Error) {
          if (k < maxTries) {
            continue;
          }
          throw new Error(
            `Could not confirm that instance manager started because of an error while reading the pid file at "${managerPidPath}": ${instanceManagerPidText.message}`
          );
        }
        const running = await isProcessRunningByPid(
          parseInt(instanceManagerPidText, 10)
        );
        if (!running) {
          if (k === Math.floor(maxTries / 2)) {
            c.log(
              `Instance manager pid file has "${parseInt(
                instanceManagerPidText,
                10
              ).toString()}" but it is not running`
            );
          }
          if (k < maxTries) {
            continue;
          }
          throw new Error(
            `The instance manager process is not running at pid ${instanceManagerPidText} after starting it for "${ev.path.repository}"`
          );
        }
        c.log(
          `Instance manager started sucessfully and is running at pid "${instanceManagerPidText}"`
        );
        c.log("");
        break;
      }
    }
  }
  // Step 9
  if (ev.config.suggestedCronjobSetup === undefined) {
    c.log("Step 9. [Optional] Setup Cron to Restart on Reboot");
    c.log("");
    c.log("  The instance manager maintains your app process running.");
    c.log("  If your server reboots it will stop and so will your app.");
    c.log("  You can make it start automatically by configuring the cronjob.");
    process.stdout.write("\n");
    const confirmation = await waitForUserConfirmation(
      " > Do you want to configure the reboot script?"
    );
    process.stdout.write("\n");
    ev.config.suggestedCronjobSetup = confirmation;
    await saveConfig();
    if (confirmation === true) {
      c.log("");
      c.log(
        "The following command must be executed on another shell on this server:"
      );
      c.log("");
      c.log("$ crontab -e");
      c.log("");
      c.log(
        "Your cron configuration should open for editing. Add this line at the end of it:"
      );
      c.log("");
      c.log(
        `@reboot cd ${ev.path.repository} && /usr/bin/node ./deployment/node-deployment.js --manager ${ev.path.repository}`
      );
      c.log("");
      c.log(
        "Save the file and cron will start the process when the computer boots up."
      );
      c.log("");
      process.stdout.write("\nPress enter to continue\n");
      await waitForUserInput();
    } else {
      c.log("");
      c.log("Skipped cron job setup");
      c.log("");
    }
  }
  if (!ev.config.setupComplete) {
    ev.config.setupComplete = true;
    c.log("Setup is complete.");
    c.log("");
    c.log(
      `The repository of the project at "${ev.path.repository}" is ready to be used.`
    );
    c.log("");
    c.log(`When it updates the automatic deployment pipeline will start.`);
    c.log("");
    c.log(
      `Every pipeline creates a new folder at "${path.resolve(
        ev.path.repository,
        "deployment",
        "versions"
      )}/[id]"`
    );
    c.log("");
    c.log(`The current pipeline steps can be configured.`);
    c.log("");
    c.log(
      "This repository can be cloned remotely through ssh with a command like this:"
    );
    c.log("");
    c.log(
      `$ git clone ssh://[username]@[server-host]:[server-port]${ev.path.repository}`
    );
    c.log("");
    c.log(
      "Changes on any branch will trigger it to deploy, this can be configured."
    );
    c.log("");
    c.log("You will now go to the project status and configuration menu.");
    await saveConfig();
    process.stdout.write("\n\nPress enter to continue\n");
    await waitForUserInput();
  }

  await nodeDeploymentProjectConfig(ev.path.repository, ev.config, saveConfig);
}

async function getProjectConfigurationMenuState(projectPath, config) {
  const deployLogFilePath =
    config.logFilePath ||
    path.resolve(projectPath, "deployment", "deployment.log");
  const deployLogStat = await asyncTryCatchNull(
    fs.promises.stat(deployLogFilePath, "utf-8")
  );
  const [managerState, processorState, instanceState] = await Promise.all(
    ["manager", "processor", "instance"].map(async (name) => {
      const pidFilePath = path.resolve(
        projectPath,
        "deployment",
        `${name}.pid`
      );
      const obj = {
        pid: null,
        running: false,
      };
      try {
        const text = await asyncTryCatchNull(
          fs.promises.readFile(pidFilePath, "utf-8")
        );
        if (text) {
          obj.pid = parseInt(text.trim(), 10);
          obj.running = await isProcessRunningByPid(obj.pid);
        }
      } catch (err) {
        obj.running = false;
      }
      return obj;
    })
  );

  const currentInstanceFilePath = path.resolve(
    projectPath,
    "deployment",
    "instance-path.txt"
  );
  const instancePathText = await asyncTryCatchNull(
    fs.promises.readFile(currentInstanceFilePath, "utf-8")
  );

  const versionIdList = await asyncTryCatchNull(
    fs.promises.readdir(path.resolve(projectPath, "deployment", "versions"))
  );
  const versionPathList =
    versionIdList === null
      ? []
      : versionIdList.map((fileName) =>
          path.resolve(projectPath, "deployment", "versions", fileName)
        );

  /** @type {{id: string, repositoryPath: string, isCurrentInstance: boolean, logFilePath: string, logFileSize: null | number}[]} */
  const versionList = await Promise.all(
    versionPathList.map(async (repositoryPath) => {
      const isCurrentInstance =
        instancePathText && instancePathText.trim() === repositoryPath;
      const obj = {
        id: path.basename(repositoryPath),
        repositoryPath,
        isCurrentInstance,
        logFilePath: path.resolve(repositoryPath, "instance.log"),
        logFileSize: null,
        createdAt: null,
        startedAt: null,
      };
      try {
        const stat = await asyncTryCatchNull(
          fs.promises.stat(obj.repositoryPath)
        );
        if (stat !== null) {
          obj.createdAt = stat.ctime;
        }
        const logStat = await asyncTryCatchNull(
          fs.promises.stat(obj.logFilePath)
        );
        if (logStat !== null) {
          obj.logFileSize = logStat.size;
          obj.startedAt = logStat.ctime;
        }
      } catch (err) {
        // ignore
      }
      return obj;
    })
  );

  return {
    versionList,
    deploymentLogFilePath: deployLogFilePath,
    deploymentLogFileSize: deployLogStat ? deployLogStat.size : null,
    managerPid: managerState.pid,
    managerRunning: managerState.running,
    processorPid: processorState.pid,
    processorRunning: processorState.running,
    instanceId: instancePathText
      ? path.basename(instancePathText.trim())
      : null,
    instancePid: instanceState.pid,
    instanceRunning: instanceState.running,
    instancePath: instancePathText || null,
  };
}

async function menu(options) {
  while (true) {
    const list = Object.keys(options);
    process.stdout.write(`\n`);
    process.stdout.write(`[ 0] Exit program\n`);
    for (let i = 0; i < list.length; i++) {
      process.stdout.write(`[${(i + 1).toString().padStart(2)}] ${list[i]}\n`);
    }
    process.stdout.write("\n > Enter an option: ");
    const index = await waitForUserInput();
    process.stdout.write("\n");
    if (index === "x") {
      return;
    }
    if (index === "0") {
      process.exit(0);
    }
    if (!index) {
      process.stdout.write("Invalid option: empty\n");
      continue;
    }
    if (isNaN(parseInt(index)) || parseInt(index).toString() !== index) {
      process.stdout.write("Invalid option: not a number\n");
      continue;
    }
    const id = parseInt(index) - 1;
    const optionKey = list[id];
    if (!optionKey) {
      process.stdout.write("Invalid option: out of bounds\n");
      continue;
    }
    const f = options[optionKey];
    if (!f) {
      console.log(`No handler for "${optionKey}"`);
      continue;
    }
    try {
      if (true === (await f())) {
        break;
      }
    } catch (err) {
      console.log(`Processing failed for option "${optionKey}": ${err.stack}`);
    }
  }
}

async function nodeDeploymentProjectConfig(projectPath, config, saveConfig) {
  for (let k = 0; k < 1000; k++) {
    let state = {};
    try {
      state = await getProjectConfigurationMenuState(projectPath, config);
      c.log(`Project: ${projectPath}`);
      c.log("");
      if (state.instanceId) {
        if (state.instanceRunning) {
          c.log(
            `          App Instance: running at pid ${state.instancePid} (id "${state.instanceId}")`
          );
        } else {
          c.log(
            `          App Instance: not running (id "${state.instanceId}")`
          );
        }
      } else {
        c.log(`          App Instance: not running (no instance id)`);
      }
      if (state.instanceId) {
        const versionDate = getDateFromVersionId(state.instanceId);
        if (versionDate) {
          const currentId = getCurrentVersionId();
          const currentDate = getDateFromVersionId(currentId, true);
          offsetString = getDateDifferenceString(currentDate, versionDate);
          c.log(
            `          Version date: ${getDateStringConfigAware(
              versionDate
            )} (${getDateDifferenceString(currentDate, versionDate)})`
          );
        }
      }
      c.log(
        `    Deployment Manager: ${
          state.managerRunning ? "running" : "not running"
        } ${
          state.managerRunning
            ? `at pid ${state.managerPid}`
            : state.managerPid
            ? `last pid was ${state.managerPid}`
            : "no pid info"
        }`
      );
      c.log(
        `  Deployment Processor: ${
          state.processorRunning ? "running" : "not running"
        } ${
          state.processorRunning
            ? `at pid ${state.processorPid}`
            : state.processorPid
            ? `last pid was ${state.processorPid}`
            : "no pid info"
        }`
      );
      if (state.versionList.length === 1) {
        c.log(
          `      Project versions: ${state.versionList.length} version ("${
            state.versionList[state.versionList.length - 1].id
          }")`
        );
      } else if (state.versionList.length) {
        c.log(
          `      Project versions: ${
            state.versionList.length
          } versions (last was "${
            state.versionList[state.versionList.length - 1].id
          }")`
        );
      } else {
        c.log(`      Project versions: 0 versions`);
      }
      console.log("");
      console.log(" Menu options:");
    } catch (err) {
      console.log("");
      console.log("Failed while retrieving project state:");
      console.log(err.stack);
      console.log("");
      console.log(`Node Deployment Configuration Menu`);
      console.log("");
    }

    async function tailLog(targetFile, lineCount = 100, follow) {
      await new Promise(async (resolve) => {
        try {
          const args = follow
            ? ["--lines", lineCount.toString(), "--follow", targetFile]
            : ["--lines", "100", targetFile];
          const child = cp.spawn("tail", args, {
            cwd: path.dirname(targetFile),
            stdio: ["inherit", "inherit", "inherit"],
          });
          child.on("error", (err) => {
            console.log(`Could not execute the "tail" command: ${err.message}`);
            resolve();
          });
          child.on("exit", () => resolve());
        } catch (err) {
          console.log(`Failed while starting "tail" command: ${err.message}`);
          resolve();
        }
      });
    }

    await menu({
      "Refresh info": async () => true,
      "View instance logs": async () => {
        if (!state.versionList || !state.versionList.length) {
          console.log(
            "Cannot read instance logs because there are no instances on this project"
          );
          console.log("  No changes have been pushed to this repository yet");
          console.log("");
          return true;
        }
        const instanceList = state.versionList.filter(
          (version) =>
            typeof version.logFileSize === "number" && version.logFileSize > 0
        );
        if (instanceList.length === 0) {
          console.log(
            "Cannot read instance logs because there is no instance log file on this project"
          );
          console.log(
            `  There are ${state.versionList.length} versions but no instances on this project`
          );
          console.log("");
          return true;
        }
        const runningInstance = state.versionList.find(
          (c) => c.isInstanceRunning
        );
        const lastInstance = instanceList[instanceList.length - 1];
        if (runningInstance && runningInstance !== lastInstance) {
          console.log(
            `Warning: The running instance "${runningInstance.id}" is not the latest deployed version ("${lastInstance.id}")`
          );
          console.log("");
        }
        const logFilePath = runningInstance
          ? runningInstance.logFilePath
          : lastInstance.logFilePath;
        const logStat = await asyncTryCatchNull(fs.promises.stat(logFilePath));
        if (logStat instanceof Error || logStat === null) {
          console.log(`Could not load log file at "${logFilePath}"`);
          console.log("");
          return true;
        }

        console.log(`  Log file path: "${logFilePath}"`);
        console.log(
          `    Log details: ${(logStat.size / 1024).toFixed(
            0
          )} KB and was last updated at ${getDateStringConfigAware(
            logStat.mtime
          )} (${getDateDifferenceString(new Date(), logStat.mtime)}).`
        );

        await menu({
          "Print last 50 lines": async () => {
            await tailLog(logFilePath, 50);
          },
          "Print last 100 lines": async () => {
            await tailLog(logFilePath, 100);
          },
          "Watch log (print as it grows)": async () => {
            await tailLog(logFilePath, 100, true);
          },
          "Go back to previous menu": async () => true,
        });
        return true;
      },
      "View deployment logs": async () => {
        const logFilePath = state.deploymentLogFilePath;
        const logStat = await asyncTryCatchNull(fs.promises.stat(logFilePath));
        if (logStat instanceof Error || logStat === null) {
          console.log(`Could not load log file at "${logFilePath}"`);
          console.log("");
          return true;
        }

        console.log(`  Log file path: "${logFilePath}"`);
        console.log(
          `    Log details: ${(logStat.size / 1024).toFixed(
            0
          )} KB and was last updated at ${getDateStringConfigAware(
            logStat.mtime
          )} (${getDateDifferenceString(new Date(), logStat.mtime)}).`
        );
        console.log("");

        await menu({
          "Print last 50 lines": async () => {
            await tailLog(logFilePath, 50);
          },
          "Print last 100 lines": async () => {
            await tailLog(logFilePath, 100);
          },
          "Watch log (print as it grows)": async () => {
            await tailLog(logFilePath, 100, true);
          },
          "Go back to previous menu": async () => true,
        });
        return true;
      },
      "Instance management": async () => {
        if (!state.versionList || !state.versionList.length) {
          console.log(
            "Cannot manage app instance because the project has no published versions"
          );
          console.log("  No changes have been pushed to this repository");
          console.log("");
          return true;
        }
        const runningInstance = state.versionList.find(
          (c) => c.isInstanceRunning
        );
        if (runningInstance) {
          console.log(
            `The version of the running instance is "${runningInstance.id}"`
          );
          console.log("");
        }
        const instancePidPath = path.resolve(
          projectPath,
          "deployment",
          "instance.pid"
        );
        const instancePidText = await asyncTryCatchNull(
          fs.promises.readFile(instancePidPath, "utf-8")
        );
        let isRunning = false;
        if (instancePidText === null || instancePidText instanceof Error) {
          console.log(
            `Could not read instance pid at "${instancePidPath}": ${
              instancePidText === null
                ? "it does not exist"
                : "an error occured"
            }`
          );
          console.log("");
        } else {
          isRunning = await isProcessRunningByPid(instancePidText);
          console.log(
            `The instance pid ${
              isRunning ? "is" : "was"
            } ${instancePidText.trim()} and it ${
              isRunning ? "is running" : "is not running"
            }`
          );
        }

        const instancePathFilePath = path.resolve(
          projectPath,
          "deployment",
          "instance-path.txt"
        );
        const instanceFilePath = await asyncTryCatchNull(
          fs.promises.readFile(instancePathFilePath, "utf-8")
        );
        if (instanceFilePath === null || instanceFilePath instanceof Error) {
          console.log(
            `Could not read instance path from "${instancePathFilePath}": ${
              instanceFilePath === null
                ? "it does not exist"
                : "an error occured"
            }`
          );
          console.log("");
        } else {
          if (isRunning) {
            console.log(`   Last instance path: "${instanceFilePath.trim()}"`);
          } else {
            console.log(`Current instance path: "${instanceFilePath.trim()}"`);
          }
          console.log("");
        }

        let options = {};
        options["Refresh menu values"] = async () => {};

        const lastInstanceVersion = instanceFilePath
          ? path.basename(instanceFilePath)
          : null;
        const targetId = lastInstanceVersion
          ? lastInstanceVersion
          : state.versionList[state.versionList.length - 1].id;

        const restartInstance = async (targetRepositoryPath) => {
          let instancePidStat;
          try {
            instancePidStat = await asyncTryCatchNull(
              fs.promises.stat(instancePidPath, "utf-8")
            );
          } catch (err) {
            console.log(`Could not stat "${instancePidPath}"`);
          }
          const realTarget = targetRepositoryPath
            ? targetRepositoryPath
            : instanceFilePath
            ? instanceFilePath
            : state.versionList[state.versionList.length - 1].repositoryPath;
          console.log(
            `Sending request to manager to restart at version "${path.basename(
              realTarget
            )}"`
          );
          let response, text;
          try {
            response = await fetch(`http://localhost:${config.managerPort}/`, {
              method: "POST",
              body: JSON.stringify({
                repositoryPath: realTarget,
              }),
            });
            text = await response.text();
          } catch (err) {
            console.log(
              `Request to restart at version "${path.basename(
                realTarget
              )}" failed: ${err.message}`
            );
            return;
          }
          if (text) {
            console.log(`Instance manager response: ${text}`);
          }
          if (!response.ok) {
            throw new Error("Instance manager responded with error");
          }
          let i;
          for (i = 0; i < 49; i++) {
            if (i === 5) {
              console.log(
                `Waiting for instance pid file to update at "${instancePidPath}"`
              );
            }
            const newInstancePidStat = await asyncTryCatchNull(
              fs.promises.stat(instancePidPath, "utf-8")
            );
            // was nothing and became something
            if (
              (instancePidStat === null || instancePidStat instanceof Error) &&
              newInstancePidStat instanceof fs.Stats
            ) {
              break;
            }
            // was something and changed
            if (
              instancePidStat instanceof fs.Stats &&
              newInstancePidStat instanceof fs.Stats &&
              instancePidStat.mtimeMs !== newInstancePidStat.mtimeMs
            ) {
              break;
            }
            await sleep(200);
            if (i === 49) {
              console.log(
                `Instance pid file at "${instancePidPath}" was not updated`
              );
              return;
            }
          }
          const pid = await fs.promises.readFile(instancePidPath, "utf-8");
          console.log(`New instance pid is ${pid}`);
          return true;
        };
        const selectInstanceAndRestart = async () => {
          const options = {};
          options["Refresh menu values"] = async () => {};
          const versionList = await asyncTryCatchNull(
            fs.promises.readdir(
              path.resolve(projectPath, "deployment", "versions")
            )
          );
          if (versionList instanceof Error) {
            console.log(`Could not list versions: ${versionList.message}`);
            return true;
          }

          const currentId = getCurrentVersionId();
          const currentDate = getDateFromVersionId(currentId, true);
          for (let i = 0; i < versionList.length; i++) {
            let offsetString = "";

            if (currentDate && currentId.length === versionList[i].length) {
              const versionDate = getDateFromVersionId(versionList[i]);
              if (versionDate) {
                offsetString = `[${getDateDifferenceString(
                  currentDate,
                  versionDate
                )}]`;
              }
            }
            const key = `Restart at version "${versionList[i]}" ${offsetString}`;

            options[key] = restartInstance.bind(
              null,
              path.resolve(
                projectPath,
                "deployment",
                "versions",
                versionList[i]
              )
            );
          }
          options["Go back to previous menu"] = async () => true;
          await menu(options);
        };
        if (isRunning) {
          options[`Restart instance process at "${targetId}"`] =
            restartInstance.bind(null, "TODO DEBUG");
          options["Restart instance process at a different version"] =
            selectInstanceAndRestart;
        } else {
          options[`Start instance process at "${targetId}"`] =
            restartInstance.bind(null, "TODO DEBUG");
          options["Start instance process at a different version"] =
            selectInstanceAndRestart;
        }
        if (isRunning && instancePidText && instancePidText.trim()) {
          options[`Stop instance process at pid ${instancePidText}`] =
            async () => {
              await killProcessByPid(instancePidText, "instance");
            };
          options[
            `Stop instance process with "kill" at pid ${instancePidText}`
          ] = async () => {
            const killStartDate = new Date();
            cp.execSync(`kill -9 ${instancePidText.trim()}`);
            for (let i = 0; i < 50; i++) {
              await sleep(200);
              if (!(await isProcessRunningByPid(pid))) {
                const delay =
                  (new Date().getTime() - killStartDate.getTime()) / 1000;
                console.log(
                  `process stopped after ${delay.toFixed(1)} seconds`
                );
                return;
              }
            }
            const delay =
              (new Date().getTime() - killStartDate.getTime()) / 1000;
            console.log(
              `process is still running ${delay.toFixed(
                1
              )} seconds after attempting to kill it`
            );
          };
        }
        options["Go back to previous menu"] = async () => true;
        console.log("Instance Management Menu Options:");
        await menu(options);
        return true;
      },
      "Deployment management": async () => {
        console.log("");
        for (const name of ["processor", "manager"]) {
          const pidFilePath = path.resolve(
            projectPath,
            "deployment",
            name + ".pid"
          );
          const pid = await asyncTryCatchNull(
            fs.promises.readFile(pidFilePath, "utf-8")
          );
          process.stdout.write(
            ` ${name[0].toUpperCase()}${name.substring(1)} pid: `
          );
          if (typeof pid === "string" && pid) {
            if (await isProcessRunningByPid(pid)) {
              process.stdout.write(pid + " (running)\n");
            } else {
              process.stdout.write("was" + pid + " (not running)\n");
            }
          } else if (pid === null) {
            process.stdout.write("none (never ran)\n");
          } else if (pid instanceof Error) {
            process.stdout.write("error while reading\n");
          } else {
            process.stdout.write("Unknown\n");
          }
        }
        console.log("");
        async function stopProcessByName(name) {
          const pidFilePath = path.resolve(
            projectPath,
            "deployment",
            name + ".pid"
          );
          const pid = await asyncTryCatchNull(
            fs.promises.readFile(pidFilePath, "utf-8")
          );
          if (!(pid && typeof pid === "string")) {
            console.log(
              `${name[0].toUpperCase()}${name.substring(
                1
              )} process does not exist`
            );
            return;
          }
          await killProcessByPid(pid, name);
        }
        async function startProcessByName(name) {
          const pidFilePath = path.resolve(
            projectPath,
            "deployment",
            name + ".pid"
          );
          const pid = await asyncTryCatchNull(
            fs.promises.readFile(pidFilePath, "utf-8")
          );
          if (pid && typeof pid === "string") {
            if (await isProcessRunningByPid(pid)) {
              console.log(
                `Cannot start ${name} process because it is already executing at pid ${pid}`
              );
              return;
            }
          }
          console.log(
            `Starting ${name[0].toUpperCase()}${name.substring(1)} process`
          );
          const child = cp.spawn(
            "node",
            ["./deployment/node-deployment.js", `--${name}`, projectPath],
            {
              cwd: projectPath,
              env: process.env,
              stdio: "ignore",
              detached: true,
            }
          );
          child.unref();
          let i;
          for (i = 0; i < 10; i++) {
            if (i === 5) {
              console.log(
                `Waiting for ${name} pid file to update at "${pidFilePath}"`
              );
            }
            const newPid = await asyncTryCatchNull(
              fs.promises.readFile(pidFilePath, "utf-8")
            );
            if (newPid && typeof newPid === "string" && newPid !== pid) {
              break;
            }
            if (i === 49) {
              console.log(
                `${name} pid file at "${pidFilePath}" was not updated`
              );
              return;
            }
            await sleep(200);
          }
          const newPid = await fs.promises.readFile(pidFilePath, "utf-8");
          if (newPid && typeof newPid === "string") {
            console.log(`The ${name} process started with pid ${newPid}`);
            await sleep(400);
            if (!(await isProcessRunningByPid(newPid))) {
              console.log(`It has exited and is no longer executing`);
            }
            await sleep(400);
            if (!(await isProcessRunningByPid(newPid))) {
              console.log(`It has exited and is no longer executing`);
            }
          }
        }
        const options = {
          "Go back": async () => true,
          "Refresh menu values": async () => {},
          "Start (or restart) deployment processor process": async () => {
            await stopProcessByName("processor");
            await startProcessByName("processor");
          },
          "Start (or restart) instance manager process": async () => {
            await stopProcessByName("manager");
            await startProcessByName("manager");
          },
          "Stop deployment processor process": async () => {
            await stopProcessByName("processor");
          },
          "Stop instance manager process": async () => {
            await stopProcessByName("manager");
          },
        };
        await menu(options);
        return true;
      },
      Configuration: async () => {
        console.log("Configuration menu options");
        await menu({
          "Go back": async () => true,
          "Change date offset (version id and logs)": async () => {
            if (config.hourOffset) {
              let hours = config.hourOffset;
              console.log(
                `    Current offset: ${Math.floor(hours)
                  .toString()
                  .padStart(2, "0")}:${Math.abs(Math.floor(hours % 60))
                  .toString()
                  .padStart(2, "0")}`
              );
              console.log(``);
            } else {
              console.log(`    Current offset: disabled`);
              console.log(``);
            }
            process.stdout.write(` > Input the offset in hours: `);
            const value = await waitForUserInput();
            process.stdout.write(`\n`);
            if (!value || isNaN(parseFloat(value))) {
              console.log(`Could not understand input`);
              return;
            }
            hours = parseFloat(value) / (60 * 1000);
            console.log(
              `    New offset: ${Math.floor(hours)
                .toString()
                .padStart(2, "0")}:${Math.abs(Math.floor(hours % 60))
                .toString()
                .padStart(2, "0")}`
            );
            console.log(``);
            console.log(
              `  Time now with offset: ${getDateStringAtOffset(
                new Date(),
                hours
              )}`
            );
            console.log(``);
            if (!(await waitForUserConfirmation(" > Confirm new offset?"))) {
              return;
            }
            const freshConfig = await getProjectConfig(projectPath, true);
            const configPath = path.resolve(
              projectPath,
              "deployment",
              "config.json"
            );
            freshConfig.hourOffset = parseFloat(value) / (60 * 1000);
            await fs.promises.writeFile(
              configPath,
              JSON.stringify(freshConfig, null, "  "),
              "utf-8"
            );
            config = freshConfig;
          },
          "Anything else": async () => {
            console.log("Sorry, this feature is not currently implemented\n");
            console.log("You may try to edit the config manually\n");
            console.log(
              `  Config path: ${path.resolve(
                projectPath,
                "deployment",
                "config.json"
              )}`
            );
          },
        });
        return true;
      },
      "Navigate version files": async () => {
        const versionList = await asyncTryCatchNull(
          fs.promises.readdir(
            path.resolve(projectPath, "deployment", "versions")
          )
        );
        if (versionList instanceof Error) {
          console.log(`Could not list versions: ${versionList.message}`);
          return true;
        }
        if (versionList === null) {
          console.log(
            `Could not list versions at "${path.resolve(
              projectPath,
              "deployment",
              "versions"
            )}"`
          );
          return true;
        }
        console.log(
          `Select one of the options below which includes the ${versionList.length} versions available`
        );
        const obj = {
          "Go back": async () => true,
        };
        const currentId = getCurrentVersionId();
        const currentDate = getDateFromVersionId(currentId, true);
        for (let i = 0; i < versionList.length; i++) {
          let offsetString = "";

          if (currentDate && currentId.length === versionList[i].length) {
            const versionDate = getDateFromVersionId(versionList[i]);
            if (versionDate) {
              offsetString = getDateDifferenceString(currentDate, versionDate);
            }
          }

          const id = versionList[i];
          let key = ` v ${id}`;
          if (offsetString) {
            key = `${key}  (${offsetString})`;
          }
          obj[key] = (async (id, offsetString) => {
            console.log("");
            console.log(
              `Selected instance version "${id}" (${
                offsetString ? `${offsetString}` : "unknown creation date"
              })`
            );
            console.log("");

            process.stdout.write(`   Instance path: `);
            const instancePath = path.resolve(
              projectPath,
              "deployment",
              "versions",
              id
            );
            {
              console.log(`"${instancePath}"`);
            }
            process.stdout.write(`   Instance logs: `);
            {
              const stat = await asyncTryCatchNull(
                fs.promises.stat(path.resolve(instancePath, "instance.log"))
              );
              if (stat === null || stat instanceof Error) {
                console.log(
                  stat === null
                    ? "not created (file does not exist)"
                    : `could not be read at "${path.resolve(
                        instancePath,
                        "instance.log"
                      )}"`
                );
              } else {
                process.stdout.write(
                  stat.size < 1024 * 1024
                    ? `${(stat.size / 1024).toFixed(1)} KB`
                    : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`
                );
                process.stdout.write(
                  ` last updated at ${getDateStringConfigAware(stat.mtime)} (`
                );
                const minutes =
                  (new Date().getTime() - stat.mtimeMs) / (60 * 1000);
                if (minutes < 60) {
                  console.log(`${Math.floor(minutes)} minutes ago)`);
                } else if (minutes < 24 * 60) {
                  console.log(`${Math.floor(minutes / 60)} hours ago)`);
                } else {
                  console.log(`${Math.floor(minutes / (24 * 60))} days ago)`);
                }
              }
            }
            process.stdout.write(`        Contents: `);
            {
              const fileList = await asyncTryCatchNull(
                fs.promises.readdir(path.resolve(instancePath))
              );
              process.stdout.write(`${fileList.length} files`);
              if (fileList.join(", ").length < 50) {
                console.log(` (${fileList.join(", ")})`);
              } else {
                console.log("");
              }
            }
            console.log("");
          }).bind(obj, id, offsetString);
        }
        obj["Finish program"] = async () => {
          return true;
        };
        await menu(obj);
        return true;
      },
      "Finish program": async () => {
        return true;
      },
    });
  }
}

async function nodeDeploymentSetup() {
  if (args[0] && args[0].startsWith("--")) {
    const target = path.resolve(process.cwd(), "deployment", "deployment.log");
    if (fs.existsSync(target)) {
      c.logFilePath = target;
    } else {
      const target = path.resolve(process.cwd(), "deployment.log");
      if (
        path.basename(process.cwd()) === "deployment" &&
        fs.existsSync(target)
      ) {
        c.logFilePath = target;
      }
    }
    c.log("Invalid argument for project directory");
    process.exit(1);
  }

  let targetPath = args.length >= 1 ? path.resolve(args[0]) : "";

  // Check if we must change our log file path
  {
    const startConfig = await getProjectConfig(
      targetPath ? targetPath : process.cwd()
    );

    if (startConfig && startConfig.logFilePath) {
      c.logFilePath = startConfig.logFilePath;
    } else {
      const target = path.resolve(
        process.cwd(),
        "deployment",
        "deployment.log"
      );
      if (fs.existsSync(target)) {
        c.logFilePath = target;
      }
    }
  }

  c.log("");
  c.log("Node deployment script");
  c.log("");
  c.log(`   process id: ${process.pid}`);
  c.log(`    parent id: ${process.ppid}`);
  c.log(` current path: ${process.cwd()}`);
  c.log(`    logs file: ${c.logFilePath}`);
  if (targetPath) {
    c.log(` project path: ${targetPath}`);
  }
  c.log("");

  startUserInput();

  let skipFirstPathInput = false;
  if (
    !targetPath &&
    fs.existsSync("./hooks") &&
    fs.existsSync("./HEAD") &&
    fs.existsSync("./refs")
  ) {
    console.log("");
    console.log("The current working directory has a git bare repository");
    console.log("");
    console.log(`Do you want to select "${process.cwd()}"?`);
    process.stdout.write("\n");
    const confirm = await waitForUserConfirmation(` > Select this project?`);
    process.stdout.write("\n");
    if (confirm) {
      targetPath = process.cwd();
      skipFirstPathInput = true;
    }
  }

  for (let k = 0; k < 1000; k++) {
    const shouldSkip = k === 0 && skipFirstPathInput;
    if (!shouldSkip) {
      if (k !== 0 || args.length === 0) {
        process.stdout.write(
          "\nEnter the path for the project repository:\n\n > "
        );
      }
      const newPath =
        k === 0 && args.length === 1 ? targetPath : await waitForUserInput();
      process.stdout.write("\n");
      if (!newPath || newPath.length > 256) {
        process.stdout.write("Invalid path. Try again\n");
        continue;
      }
      const resPath = path.resolve(newPath);
      if (resPath !== newPath) {
        process.stdout.write("Expanded path: ");
      } else {
        process.stdout.write("Selected path: ");
      }
      process.stdout.write(`${resPath}\n`);
      const stat = await asyncTryCatchNull(fs.promises.stat(resPath));
      if (stat === null) {
        process.stdout.write("\nThis directory does not exist yet.\n");
      } else if (!stat.isDirectory()) {
        process.stdout.write(
          "\nThis path cannot be used because it is a file.\n"
        );
        continue;
      }
      process.stdout.write("\n");
      const confirm = await waitForUserConfirmation(
        stat === null
          ? " > Create the new directory for the project?"
          : " > Confirm target repository path?"
      );
      process.stdout.write("\n");
      if (confirm === false) {
        continue;
      }
      targetPath = resPath;
    }
    c.log("");
    for (let m = 0; m < 1000; m++) {
      if (m !== 0) {
        c.log(``);
        c.log(
          `Node deployment will run configuration for "${targetPath}" again.`
        );
        await sleep(500);
      }
      try {
        await executeNodeDeploymentSetupForProject(targetPath);
      } catch (err) {
        c.log(`Node deployment configuration for "${targetPath}" failed:`);
        c.log("");
        c.log(err.stack);
        c.log("");
        process.stdout.write("\n");
        const confirmRetry = await waitForUserConfirmation(
          " > Do you want to retry?"
        );
        if (confirmRetry === false) {
          process.exit(1);
        }
        c.log("You may retry at the same path or choose another.");
        process.stdout.write("\n");
        const confirmSame = await waitForUserConfirmation(
          " > Do you want to retry at the same path?"
        );
        if (confirmSame === true) {
          continue;
        }
      }
      break;
    }
  }
}

async function killProcessByPid(pid, name) {
  if (!(await isProcessRunningByPid(pid))) {
    console.log(
      `${name[0].toUpperCase()}${name.substring(1)} process is stopped`
    );
    return;
  }
  console.log(`Stopping ${name} process at pid ${pid}...`);
  try {
    process.kill(pid);
  } catch (err) {
    console.log(`Error while killing the ${name} process: ${err.message}`);
  }
  const killStartDate = new Date();
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (!(await isProcessRunningByPid(pid))) {
      console.log(
        `${name[0].toUpperCase()}${name.substring(1)} process has stopped`
      );
      return;
    }
  }
  const delay = (new Date().getTime() - killStartDate.getTime()) / 1000;
  console.log(
    `${name[0].toUpperCase()}${name.substring(
      1
    )} process is still running ${delay.toFixed(
      1
    )} seconds after attempting to kill it`
  );
}
async function getProcessParentIdByPid(pid) {
  const statusFilePath = "/proc/" + pid + "/status";

  if (!fs.existsSync(statusFilePath)) {
    return null;
  }

  const statusContent = fs.readFileSync(statusFilePath, "utf8");
  const lines = statusContent.toLowerCase().split("\n");

  for (const line of lines) {
    if (line.startsWith("ppid:")) {
      const parentPid = parseInt(line.substring(5).trim());
      return parentPid;
    }
  }

  return null;
}

async function isProcessRunningByPid(pid) {
  let yesCount = 0;
  let noCount = 0;
  for (let i = 0; i < 8; i++) {
    try {
      process.kill(parseInt(pid.toString().trim()), 0);
      yesCount++;
    } catch (err) {
      noCount++;
    }
    await sleep(500);
  }
  return yesCount > noCount;
}

function processHttpServerRequest(name, targetFunc, req, res) {
  if (req.method !== "POST") {
    res
      .writeHead(404)
      .end(req.url === "/" ? `${name} internal http server` : "");
    return;
  }
  if (req.url === "/kill") {
    res.end();
    c.log(
      `The ${name} received a kill request in its internal http server and will terminate`
    );
    setTimeout(() => {
      process.exit(1);
    }, 50);
    return "ok";
  }
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", async () => {
    try {
      const requestData = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const responseData = await targetFunc(requestData);
      if (responseData) {
        res.end(responseData);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      res.writeHead(500);
      res.end(`${name} failed: ${err.message}`);
      return;
    }
  });
}

async function asyncTryCatchNull(p) {
  try {
    return await p;
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function getStartingPipelineSteps() {
  return [
    {
      id: "reuse",
      name: "Reuse previous deployment folder",
      command:
        "cp -rf ./deployment/versions/<current-instance-id> ./deployment/versions/<new-instance-id>",
      description:
        "Copies the files of the current running instance to speed up the deployment pipeline of the new instance",
      question: "Reuse previous instance contents?",
    },
    {
      id: "purge",
      name: "Remove old instance folders and keep only the 15 most recent",
      description:
        'Executes when there are more than 15 pipeline folders and removes old instance folders at "./deployment/versions" so that only the 15 versions are kept',
      command: "rm -rf ./deployment/versions/<old-instance-id>",
      question: "Purge old instance folders and keep only the 15 most recent?",
    },
    {
      id: "install",
      name: "Install project dependencies with npm",
      command: "npm ci",
      question: "Install the dependencies from package.json?",
    },
    {
      id: "script",
      name: 'Execute "build" script',
      command: "npm run build",
      question: 'Execute the "build" script from package.json?',
    },
    {
      id: "restart",
      name: "Restart instance",
      description:
        "Stops the instance running on the previous version and starts the new one on the new pipeline folder.",
      command: "npm run start",
      question: "Restart the process executes app instance?",
    },
  ];
}

async function waitForUserInput() {
  return await new Promise((resolve) => {
    global.userInputResolve = resolve;
  });
}

function startUserInput() {
  if (global.userInput) {
    return;
  }
  global.userInput = true;
  process.stdin.on("data", (data) => {
    const resolve = global.userInputResolve;
    if (resolve) {
      global.userInputResolve = null;
      resolve(data.toString("utf-8").trim());
    }
  });
}

function getFormattedHourDifference(date1, date2) {
  const delta = Math.abs(date1.getTime() - date2.getTime());
  const hours = Math.floor(delta / (1000 * 60 * 60));
  const minutes = Math.floor((delta % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((delta % (1000 * 60)) / 1000);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getDateStringAtOffset(date = new Date(), offset) {
  return new Date(
    date.getTime() +
      (offset && typeof offset === "number" && offset >= -24 && offset <= 24
        ? offset
        : 0) *
        60 *
        60 *
        1000
  )
    .toISOString()
    .replace("T", " ");
}

function getDateStringConfigAware(date = new Date()) {
  if (!global || !global.cachedConfig || !global.cachedConfig.hourOffset) {
    return date.toISOString();
  }
  return getDateStringAtOffset(date, global.cachedConfig.hourOffset);
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Math.min(60_000, ms)))
  );
}

function getDateDifferenceString(futureDate, pastDate) {
  const delta = futureDate.getTime() - pastDate.getTime();
  const minutes = delta / (60 * 1000);
  if (minutes > -1.1 && minutes < 1.1) {
    return "Just now";
  }
  if (minutes > -2 && minutes <= -1) {
    return "In a minute";
  }
  if (minutes >= 1 && minutes < 2) {
    return "A minute ago";
  }
  if (minutes >= -60 && minutes <= 0) {
    return `In ${(-minutes).toFixed(0)} minutes`;
  }
  if (minutes >= 0 && minutes <= 60) {
    return `${minutes.toFixed(0)} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  const leftOverMinutes = Math.floor(minutes) % 60;
  if (hours === 1) {
    if (leftOverMinutes === 1) {
      return `1 hour and a minute ago`;
    }
    if (leftOverMinutes > 1) {
      return `1 hour and ${leftOverMinutes} minutes ago`;
    }
    return `1 hour ago`;
  }
  if (hours <= 0) {
    if (hours >= -1) {
      return `In 1 hour`;
    }
    if (hours > -24) {
      return `In ${-hours} hours`;
    }
    if (hours > -48) {
      return `In 1 day`;
    }
    if (hours >= -30 * 24) {
      return `In ${Math.floor(-hours / 24)} days`;
    }
    return "In more than a month";
  }
  if (hours < 24) {
    if (leftOverMinutes === 0) {
      return `${hours} hours ago`;
    }
    return `${hours} hours and ${
      leftOverMinutes === 1 ? "1 minute" : `${leftOverMinutes} minutes`
    } ago`;
  }
  const days = Math.floor(hours / 24);
  const leftOverHours = hours % 24;
  return leftOverHours == 0
    ? days === 1
      ? `1 day ago`
      : `${days} days ago`
    : leftOverHours == 1
    ? `${days} ${days === 1 ? "day" : "days"} and 1 hour ago`
    : `${days} ${days === 1 ? "day" : "days"} and ${leftOverHours} hours ago`;
}
