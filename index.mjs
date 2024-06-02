import { initProcessor } from "./src/process.mjs";
import { initManager } from "./src/manager.mjs";
import { initScheduler } from "./src/schedule.mjs";
import { initSetup } from "./src/setup.mjs";
import { attachToProcessLog, setPersistFilePath } from "./src/lib/attachToProcessLog.mjs";
import { schedulerLog, processorLog, managerLog, setupLog, programMode } from "./config.mjs";

const modes = {
  "schedule": { init: initScheduler, log: schedulerLog },
  "process": { init: initProcessor, log: processorLog },
  "manager": { init: initManager, log: managerLog },
  "setup": { init: initSetup, log: setupLog },
};

const arg = process.argv[2] || '--setup';
const key = arg.replace(/\W/g, '').toLowerCase().trim();
const target = modes[key.startsWith('sc') ? 'schedule' : key.startsWith('se') ? 'setup' : key.startsWith('p') ? 'process' : key];
if (!target) {
  console.log(`Unknown mode argument: ${JSON.stringify(process.argv[2])}`);
  process.exit(1);
}

setPersistFilePath(target.log);

attachToProcessLog();

target.init().catch((err) => {
  console.log(err);
  process.exit(1);
});
