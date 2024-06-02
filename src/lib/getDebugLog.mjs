
export function getDebugLog(isActive, ...extra) {
  if (isActive) {
    return (...args) => process.stdout.write(`[D] ${[new Date().toISOString(), ...extra.map(a => a instanceof Function ? a.name : a), args].map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`);
  }
  return () => {};
}