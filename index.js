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

const { options, remaining } = getCachedParsedProgramArgs();

if (options.mode !== "help" && options.mode !== "logs") {
  attachToConsole(
    "log",
    path.resolve(
      process.env.LOG_FOLDER_NAME || process.cwd(),
      `${options.mode}.log`
    )
  );
}

if (remaining.length) {
  console.log(`Invalid program arguments: ${JSON.stringify(remaining)}`);
  process.exit(1);
}

const initMethod = getInitForMode(options.mode);

if (!initMethod) {
  console.log(`Invalid program mode: ${JSON.stringify(process.argv)}`);
  process.exit(1);
}

options.debug &&
  console.log(
    `Starting script as "${options.mode}" mode${
      options.dry ? " in dry mode (no side effects)" : ""
    }`
  );

initMethod(options).catch((err) => {
  console.log(err);
  process.exit(1);
});
