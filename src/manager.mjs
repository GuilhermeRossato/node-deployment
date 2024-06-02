import fs from "fs";
import http from "http";
import child_process from "child_process";
import { managerPid, managerPort, productionFolder } from "../config.mjs";
import { sleep } from "./lib/sleep.mjs";
import { safeFileRead } from "./lib/safeFileRead.mjs";
import { executeCommandPredictably } from "./lib/executeCommandPredictably.mjs";
import { sendToManager } from "./lib/sendToManager.mjs";
import { safeFileStat } from "./lib/safeFileStat.mjs";
import { getDebugLog } from "./lib/getDebugLog.mjs";

const debug = true;
const maxHttpServerRetryAmount = 8;

let isTerminating = false;
let child = null;
let server = null;

function startChild() {
  child = child_process.spawn(process.argv[0], [])
}

export async function initManager() {
  const debugLog = getDebugLog(debug, initManager);
  console.log("Starting manager...");
  debugLog('Manager args', process.argv);
  server = await createServer();
  console.log("Writing pid file...");
  await fs.promises.writeFile(managerPid, process.pid.toString());
  debugLog(`${managerPid} saved with ${process.pid}`);
  const stat = await safeFileStat(productionFolder);
  if (!stat) {
    debugLog(`Production folder does not exist at ${JSON.stringify(productionFolder)}`);
  } else {
    startChild();
  }
}

async function startTermination(code = 1) {
  if (isTerminating) {
    return;
  }
  isTerminating = true;
  try {
    if (server) {
      console.log(`Terminating http server with end method`);
      await server.end();
      server = null;
    }
    if (
      child &&
      typeof child.pid === "number" &&
      (await isProcessRunningByPid(child.pid))
    ) {
      console.log(`Terminating child process with "kill -9 ${child.pid}"`);
      const result = await executeCommandPredictably(
        `kill -9 ${child.pid}`,
        process.cwd(),
        10_000
      );
      console.log({ result });
      child = null;
    }
  } catch (err) {
    console.log(err);
  }
  process.exit(code);
}

async function handleRequestData(type, body) {
  const debugLog = getDebugLog(debug);
  debugLog(`Processing request of type "${type}"`);
  if (isTerminating) {
    return { success: type === "terminate", reason: "termination in process" };
  }
  if (type === "terminate") {
    console.log("Received terminate request", body);
    setTimeout(() => {
      startTermination(0);
    }, 100);
    return { success: true, reason: "started termination" };
  }
  let current = await safeFileRead(managerPid);
  if (process.pid.toString() !== current) {
    const isRunning = current ? await isProcessRunningByPid(current) : false;
    debugLog(
      "Manager process id file was updated to",
      current,
      isRunning ? "(it is running)" : "(it is not running)"
    );
    if (isRunning) {
      startTermination(1);
    } else {
      debugLog("It will be rewritting");
      await fs.promises.writeFile(managerPid, process.pid.toString());
      current = await safeFileRead(managerPid);
    }
    return { success: false };
  }
  if (type === "upgrade") {
    console.log("Upgrade request details:");
    console.log(body);
    return { success: false, reason: "Unimplemented" };
  }
}

async function isProcessRunningByPid(pid) {
  pid = parseInt(pid.toString().trim());
  let y = 0;
  let n = 0;
  for (let i = 0; i < 8; i++) {
    try {
      process.kill(pid, 0);
      y++;
    } catch (err) {
      n++;
    }
    await sleep(50);
  }
  return y - 1 > n;
}

async function handleHttpRequest(req, res) {
  debug && console.log("[D] Handling", req.method, req.url);
  if (req.url === "/" && req.method === "GET") {
    return res.end(`Deploy Project Manager Server`);
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/")) {
    return res.writeHead(404).end();
  }
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", async () => {
    let out;
    try {
      out = await handleRequestData(
        req.url.substring("/api/".length),
        Buffer.concat(chunks).toString("utf-8")
      );
    } catch (err) {
      out = err;
    }
    if (out instanceof Error) {
      out = { success: false, message: out.message };
    } else if (!out) {
      out = { success: false, message: "unhandled" };
    }
    res.setHeader(
      "Content-Type",
      typeof out === "object" ? "application/json" : "text/plain"
    );
    res.end(typeof out === "object" ? JSON.stringify(out) : out);
  });
}

async function createServer() {
  const debugLog = getDebugLog(debug);
  for (let attempt = 0; attempt < maxHttpServerRetryAmount; attempt++) {
    if (attempt !== 0) {
      debugLog(`Retrying to start server at http://127.0.0.1:${managerPort}/`);
    }
    try {
      const server = await new Promise((resolve, reject) => {
        const server = http.createServer(handleHttpRequest);
        server.on("error", reject);
        server.listen(managerPort, "127.0.0.1", () => {
          resolve(server);
        });
      });
      debugLog(`Started server at http://127.0.0.1:${managerPort}/`);
      return server;
    } catch (err) {
      if (err && err.code === "EADDRINUSE") {
        debugLog(
          `Manager detected another server running at ${managerPort} and will be terminated by http`
        );
        const response = await sendToManager("terminate", {
          pid: process.pid,
          reason: "replacement",
        });
        if (response instanceof Error) {
          debugLog(
            `The termination request raised an error: ${response.message}`
          );
        } else {
          debugLog(
            `Response from the termination request: ${JSON.stringify(response)}`
          );
        }
        await sleep(500);
        continue;
      }
      throw err;
    }
  }
}
