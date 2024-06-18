import path from "node:path";
import { loadEnvSync } from "./src/lib/loadEnvSync.js";
import attachToConsole from "./src/lib/attachToConsole.js";
import {
  getCachedParsedProgramArgs,
  getInitForMode,
} from "./src/getProgramArgs.js";

loadEnvSync([process.cwd()], process.env);

if (!process.env.DEPLOYMENT_FOLDER_NAME) {
  process.env.DEPLOYMENT_FOLDER_NAME = "deployment";
}

const parsed = getCachedParsedProgramArgs();

if (parsed.options.mode !== "help" && parsed.options.mode !== "logs") {
  attachToConsole(
    "log",
    path.resolve(
      process.env.LOG_FOLDER_NAME || process.cwd(),
      `${parsed.options.mode}.log`
    )
  );
}

if (parsed.remaining.length) {
  console.log(`Invalid program arguments: ${JSON.stringify(parsed.remaining)}`);
  process.exit(1);
}

const initMethod = getInitForMode(parsed.options.mode);

if (!initMethod) {
  console.log(`Invalid program mode: ${JSON.stringify(process.argv)}`);
  process.exit(1);
}

parsed.options.debug &&
  console.log(
    `Starting script as "${parsed.options.mode}" mode${
      parsed.options.dry ? " in dry mode (no side effects)" : ""
    }`
  );

initMethod(parsed.options).catch((err) => {
  console.log(err);
  process.exit(1);
});
