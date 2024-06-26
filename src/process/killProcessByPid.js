
import { executeProcessPredictably } from "./executeProcessPredictably.js";

/**
 * @param {string | number} processId 
 * @param {'kill' | 'force' | 'sigint' | 'sigterm'} [type]
 */
export async function killProcessByPid(processId, type = 'force') {
  const pid = parseInt(processId.toString());
  if (isNaN(pid) || pid <= 1) {
    return null;
  }
  let result;
  if (type === 'kill' || type === 'force') {
    return await executeProcessPredictably(
      type === 'force' ? `kill -9 ${pid}` : `kill ${pid}`,
      process.cwd(),
      {timeout: 5_000}
    );
  } else {
    try {
      result = process.kill(pid, type === 'sigint' ? 'SIGINT' : 'SIGTERM');
    } catch (err) {
      result = err;
    }
  }
  return result;
}
