import path from "node:path";
import readLogFile from "../lib/readLogFile.js";
import sleep from "../lib/sleep.js";
import { outputDatedLine } from "../lib/outputDatedLine.js";
import sendInternalRequest from "../lib/sendInternalRequest.js";

const hasOnceArg = process.argv.includes('--once');

export async function initStatus() {
  const response = await sendInternalRequest("manager", "status");
  console.log('Manager Server');
  console.log(response);
  console.log('Logs');
  await sleep(1000);
  await streamStatusLogs(!hasOnceArg);
}

export async function streamStatusLogs(continuous = true, modes = ["schedule", "process", "manager", "setup"]) {
  let cursorList = modes.map(() => 0);
  for (let cycle = 0; true; cycle++) {
    const logList = await Promise.all(
      modes.map((mode, i) =>
        readLogFile(path.resolve(process.env.LOG_FOLDER_PATH || process.cwd(), `${mode}.log`), cursorList[i] || -4096)
      )
    );
    cursorList = logList.map((log) => log.size);
    const list = logList
      .map((log) =>
        log.list
          .map((o, i, a) => ({
            time: a
              .slice(0, i + 1)
              .reverse()
              .map((a) => (a.date && a.date.length > 10 ? a.date : ""))
              .map((a) => (a ? new Date(a).getTime() : NaN))
              .find((a) => !isNaN(a)),
            text: `${modes[i]} - ${o.text}`,
          }))
          .filter((o) => o.time)
      )
      .flat()
      .sort((a, b) => a.time - b.time);
    for (const { time, text } of list) {
      outputDatedLine("[S]", time, text);
      await sleep(cycle === 0 ? 15 : 30);
    }
    if (!continuous) {
      break;
    }
  }
}
