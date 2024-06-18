import { getCachedParsedProgramArgs } from "../getProgramArgs.js";

let canExecSideEffect = null;

export async function executeWrappedSideEffect(description, func, ...args) {
  if (canExecSideEffect === null) {
    const { options } = getCachedParsedProgramArgs();
    canExecSideEffect = options.dry ? false : true;
  }
  if (canExecSideEffect === false) {
    console.log(
      `Skipping side effect (dry-run enabled): ${description}`
    );
    return;
  }
  return await func(...args);
}
