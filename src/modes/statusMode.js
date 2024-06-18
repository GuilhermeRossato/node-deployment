import sendInternalRequest from "../lib/sendInternalRequest.js";
import { printPreviousLogs } from "../lib/printPreviousLogs.js";
import { spawnManagerProcess } from "../lib/spawnManagerProcess.js";

/**
 * 
 * @param {import("../getProgramArgs.js").Options} options 
 */
export async function initStatus(options) {
  let response;
  if (options.shutdown || options.restart) {
    console.log('Sending shutdown request...');
    response = await sendInternalRequest("manager", "shutdown");
    console.log(response)
    if (options.shutdown && !options.start) {
      return;
    }
  }
  if (options.shutdown || options.restart) {
    console.log('Spawning manager process...');
    await spawnManagerProcess(options.debug, options.sync);
  }
  
  console.log('Retrieving status from manager process...');
  response = await sendInternalRequest("manager", "status");
  if (response.error && response.stage === 'network') {
    console.log("Could not connect to internal server (Manager server is offline)");
    if (!options.shutdown && (options.restart || options.start)) {
      console.log("Starting manager in the background");
      spawnManagerProcess(options.debug, options.sync);
    }
  }
  response = await sendInternalRequest("manager", "status");
  console.log(response);
  if (response?.error && response.stage === 'network') {
    console.log("Could not connect to internal server (Manager server is offline)");
    console.log('Latest manager process logs:');
    const list = await printPreviousLogs(-30, ['manager']);
    if (list.length === 0) {
      console.log('There are no logs');
    }
  }
  console.log('Status mode finished');
}