import fs from "fs";
import http from "http";
import path from "path";
import child_process from "child_process";
import createInternalDataServer from "../lib/createInternalDataServer.js";
import { readPidFile } from "../lib/readPidFile.js";
import { isProcessRunningByPid } from "../lib/isProcessRunningByPid.js";
import { executeCommandPredictably } from "../lib/executeCommandPredictably.js";
import sleep from "../lib/sleep.js";
import asyncTryCatchNull from "../lib/asyncTryCatchNull.js";
import { writePidFile } from "../lib/writePidFile.js";

let terminating = false;
let child = null;
let server = null;

async function startChild() {
  const folder = process.env.PRODUCTION_FOLDER_PATH;
  let stat = await asyncTryCatchNull(fs.promises.stat(folder));
  if (!stat || !(stat instanceof fs.Stats) || !stat.isDirectory()) {
    throw new Error(`Production folder was not found at "${folder}"`);
  }
  let cmd = 'npm run start';
  const pkg = await asyncTryCatchNull(fs.promises.readFile(path.resolve(folder, 'package.json'), 'utf-8'));
  const validPkg = (pkg && typeof pkg === 'string' && pkg.length > 2 && pkg.trim().startsWith('{') && pkg.includes('scripts') && pkg.includes('start'));
  if (!validPkg) {
    stat = await asyncTryCatchNull(fs.promises.stat(path.resolve(folder, 'index.js')));
    const missingScript = (!stat || !(stat instanceof fs.Stats) || !stat.isFile());
    if (missingScript) {
      throw new Error(`Production folder has no "package.json" and no "index.js" script at "${folder}"`);
    }
    cmd = 'node index.js';
  }
  await new Promise((resolve, reject) => {
    console.log('Starting child with', cmd);
    child = child_process.spawn(cmd, {
      cwd: folder,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    child.on('error', (err) => {
      console.log('Child spawn error', err);
      reject(err);
    });
    child.on('spawn', () => {
      console.log('Child spawned');
      setTimeout(() => {
        resolve();
      }, 1000);
    });
    child.on('exit', (code) => {
      console.log('Child exit', code)
      reject(new Error(`Child exited with code ${code}`));
    });
  });
  if (child && child.pid) {
    await writePidFile('production', child.pid);
  }
  return {
    pid: child ? child.pid : null,
    cmd,
    cwd: folder,
  }
}

async function handleRequest(url, method, data) {
  if (url.endsWith('/')) {
    url = url.substring(0, url.length-1);
  }
  if (url === '/' || url === '/api' || url === '/api/status') {
    return {
      name: 'Node Deployment Internal Manager Server',
      routes: url !== '/api/status' ? ['/api/status', '/api/shutdown', '/api/stop', '/api/start', '/api/restart'] : undefined
    }
  }
  if (url === '/api/shutdown' && terminating) {
    return { success: true, reason: "Shutdown in process" };
  }
  if (terminating) {
    return { error: "Shutdown in process" };
  }
  if (url === '/api/shutdown') {
    terminating = true;
    try {
      await performShutdown();
      return { success: true, reason: "Started shutdown" };
    } catch (err) {
      terminating = false;
      return { error: `Could not shutdown: ${err.message}`, stack: err.stack}
    }
  }
  if (url === '/api/stop') {
    const {pid, running} = await readPidFile('production');
    if (!running) {
      return { success: true, reason: "Production process is not executing", pid };
    }
    const commandResult = await killProcessByPid(pid);
    await sleep(500);
    const pidResult = await readPidFile('production');
    if (pidResult.running) {
      return { error: 'Failed to kill production process', pid, commandResult }
    }
    return { success: true, reason: "Production process was killed", pid };
  }
  if (url === '/api/start' || url === '/api/restart') {
    const {pid, running} = await readPidFile('production');
    if (running && url === '/api/start') {
      return { success: true, reason: "Production process is already running", pid, cwd: process.env.PRODUCTION_FOLDER_PATH }
    }
    if (running && url === '/api/restart') {
      const commandResult = await killProcessByPid(pid);
      await sleep(500);
      const pidResult = await readPidFile('production');
      if (pidResult.running) {
        return { error: 'Failed to kill production process in order to restart', pid, commandResult }
      }
    }
    const childResult = await startChild();
    console.log('Child spawn pid', childResult.pid);
    await sleep(500);
    const pidResult = await readPidFile('production');
    if (childResult.pid !== pidResult.pid || !pidResult.running) {
      return { error: 'Failed to start production server', pid: pidResult.pid }
    }
    return { success: true, reason: "Production process was spawned", pid: pidResult.pid, cwd: childResult.cwd, cmd: childResult.cmd }
  }
  return { error: 'Unhandled url', url };
}

export async function initManager() {
  console.log("Starting manager...");
  const result = await createInternalDataServer('Node Deployment Manager Server', handleRequest);
  server = result.server;
  console.log("Internal manager server listening on", result.url);
  console.log("Writing pid file...");
  await writePidFile('manager');
}

async function killProcessByPid(pid) {
  const result = await executeCommandPredictably(
    `kill -9 ${child.pid}`,
    process.cwd(),
    10_000
  );
  console.log({ result });
  return result;
}

async function performShutdown(code = 1) {
  if (server) {
    console.log(`Terminating http server with end method`);
    await server.end();
    server = null;
  }
  try {
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
  setTimeout(() => {
    process.exit(code);
  }, 100)
}
