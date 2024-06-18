import path from "node:path";
import {
  getProgramArgs,
  getProgramInitHandlerFromMode,
} from "./src/getProgramArgs.js";
import { loadEnvSync } from "./src/lib/loadEnvSync.js";
import attachToConsole from "./src/lib/attachToConsole.js";

loadEnvSync([process.cwd()], process.env);

const parsedArgs = getProgramArgs();

attachToConsole(
  "log",
  path.resolve(
    process.env.LOG_FOLDER_PATH || process.cwd(),
    `${parsedArgs.options.mode}.log`
  )
);

if (parsedArgs.remaining.length) {
  console.log(
    `Invalid program arguments: ${JSON.stringify(parsedArgs.remaining)}`
  );
  process.exit(1);
}
const initMethod = getProgramInitHandlerFromMode(parsedArgs.options.mode);

if (!initMethod) {
  console.log(`Invalid program mode: ${JSON.stringify(process.argv)}`);
  process.exit(1);
}

initMethod(parsedArgs.options).catch((err) => {
  console.log(err);
  process.exit(1);
});
