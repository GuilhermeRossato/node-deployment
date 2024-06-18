import path from "path";
import readLogFile from "./readLogFile.js";
import sleep from "./sleep.js";

export async function getLastLogs(
  modes = ["status", "setup", "schedule", "process", "manager"],
  size = 4096
) {
  const logList = await Promise.all(
    modes.map((mode, i) =>
      readLogFile(
        path.resolve(
          process.env.LOG_FOLDER_PATH || process.cwd(),
          `${mode}.log`
        ),
        -size
      )
    )
  );
  const list = logList
    .map((log) =>
      log.list
        .map((o, i, a) => ({
          time: a
            .slice(0, i + 1)
            .reverse()
            .map((a) => a.time)
            .find((a) => a && !isNaN(a)),
          src: o.src,
          pid: o.pid,
          mode: modes[i],
          text: o.text,
        }))
        .filter((o) => o.time && !isNaN(o.time))
    )
    .flat()
    .sort((a, b) => a.time - b.time);
  return {
    list,
  };
}

export async function streamLogs(
  contFunc = async (obj, i, arr) => true,
  modes = ["schedule", "process", "manager", "setup"]
) {
  let logs = await getLastLogs(modes);
  let cursor = Math.min(logs.map(a => a.time).filter(a => a > 0))-1;
  let stopped = false;
  for (let cycle = 0; !stopped; cycle++) {
    const next = await getLastLogs(modes);
    const filtered = next.list.filter(l => l.time > cursor);
    const list = filtered;
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (true !== (await contFunc(obj, i, list))) {
        stopped = true;
        break;
      }
      cursor = obj.time;
    }
    if (stopped) {
      break;
    }
    await sleep(100);
  }
}
