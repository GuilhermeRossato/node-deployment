import { getParsedProgramArgs } from "./getProgramArgs.js";

let canExecSideEffect = null;

export function canExecuteSideEffects() {
  if (canExecSideEffect === null) {
    const { options } = getParsedProgramArgs();
    canExecSideEffect = options.dry ? false : true;
  }
  return canExecSideEffect;
}

export async function executeWrappedSideEffect(description, func, ...args) {
  if (!canExecuteSideEffects()) {
    console.log(`Skipping side effect (dry-run enabled): ${description}`);
    return false;
  }
  return await func(...args);
}
