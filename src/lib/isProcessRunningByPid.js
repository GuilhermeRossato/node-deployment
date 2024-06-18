import sleep from "./sleep.js";

export async function isProcessRunningByPid(pid) {
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
