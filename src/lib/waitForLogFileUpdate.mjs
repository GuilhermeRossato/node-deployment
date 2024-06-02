import { getPersistFilePath } from "./attachToProcessLog.mjs";
import { getLogFileStat } from "./getLogFileStat.mjs";
import { sleep } from "./sleep.mjs";
import { getDebugLog } from "./getDebugLog.mjs";

const debug = true;
const timeLimit = 4000;

export async function waitForLogFileUpdate(logFilePath = null) {
  const debugLog = getDebugLog(debug);
  const startTime = new Date().getTime();
  if (!logFilePath) {
    logFilePath = getPersistFilePath();
  }
  debugLog(`Starting loop to detect update to: ${JSON.stringify(logFilePath)}`);
  let startSize = 0;
  let updated = false;
  for (let i = 0; i < 10000; i++) {
    const stat = await getLogFileStat(logFilePath);
    const size = stat.size;
    updated = Boolean(
      size &&
        startSize &&
        !isNaN(size) &&
        !isNaN(startSize) &&
        startSize !== size
    );
    if (updated) {
      break;
    }
    const elapsed = new Date().getTime() - startTime;
    const elapsedSecondsStr = (elapsed / 1000).toFixed(1);
    if (i === 0) {
      debugLog(`First stat size: ${size} - time: ${elapsedSecondsStr} s`);
    } else if (i === 0 || i % 4 === 0 || size !== 0) {
      debugLog(`Waiting at size ${size} - time: ${elapsedSecondsStr} s`);
    }
    if (elapsed < 0 || elapsed >= timeLimit) {
      break;
    }
    if (!startSize) {
      startSize = size;
    }
    await sleep(50 + Math.random() * 100);
  }
  if (!updated) {
    throw new Error(`Timeout waiting for the log file to update`);
  }
  debugLog("Finished loop after detecting log update");
}
