import { getDebugLog } from "./lib/getDebugLog.mjs";

const debug = true;

export async function initSetup() {
  const debugLog = getDebugLog(debug);
  debugLog('Setup', {args: process.argv});
  throw new Error('Unimplemented');
}

