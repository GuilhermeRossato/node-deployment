let canExecSideEffect = true;

/**
 * @param {boolean} isDryMode 
 */
export function setIsDryMode(isDryMode) {
  canExecSideEffect = !isDryMode;
}

/**
 * @return {boolean} isDryMode 
 */
export function getIsDryMode() {
  return canExecSideEffect;
}

export async function executeWrappedSideEffect(description, func, ...args) {
  if (!canExecSideEffect) {
    console.log(
      `Skipping side effect (dry-run enabled): ${description}`
    );
  }
  return await func(...args);
}
