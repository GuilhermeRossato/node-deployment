import { executeManagerAtBackground } from "./executeManagerAtBackground.js";
import { sleep } from "./sleep.js";

let hasStartedManager = false;
let hasWaitedTermination = false;

export async function sendRunManager(
  type = "",
  data = {},
  canStartManager = true
) {
  const debug = true;
  
  debug && console.log(`Sending to manager: "${type}"`);
  try {
    const response = sendInternalRequest
    const text = await response.text();
    if (!text) {
      throw new Error(
        `Got empty server response with status ${response.status}`
      );
    }
    try {
      const obj = JSON.parse(text);
      if (
        obj &&
        obj.success === false &&
        obj.reason === "termination in process" &&
        type !== "terminate" &&
        !hasWaitedTermination
      ) {
        debug && console.log(`Waiting for termination`);
        hasWaitedTermination = true;
        setTimeout(() => (hasWaitedTermination = false), 5000);
        await sleep(500);
        return await sendRunManager(type, data, canStartManager);
      }
      return obj;
    } catch (err) {
      throw new Error(
        `Failed to interpret server response: ${JSON.stringify(
          text.substring(0, 64)
        )}`
      );
    }
  } catch (err) {
    const isFetchFailed = err.message === "fetch failed";
    if (isFetchFailed && type === 'terminate') {
      return {success: true, reason: 'no answer'};
    }
    if (
      canStartManager &&
      !hasStartedManager &&
      isFetchFailed
    ) {
      hasStartedManager = true;
      debug &&
        console.log(
          `Manager will be started in the background`
        );
      await executeManagerAtBackground();
      await sleep(500);
      return await sendRunManager(type, data, canStartManager);
    }
    debug &&
      console.log(
        `Manager request "${type}" failed: ${JSON.stringify(err.meesage)}`
      );
    if (isFetchFailed) {
      throw new Error("Offline");
    }
    return err;
  }
}
