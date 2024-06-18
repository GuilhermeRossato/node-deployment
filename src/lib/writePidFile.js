import fs from "fs";

export async function writePidFile(mode, pid = null) {
  pid = (pid || process.pid).toString();
  await fs.promises.writeFile(`${mode}.pid`, pid);
  return {
    time: new Date().getTime(),
    pid,
  };
}

