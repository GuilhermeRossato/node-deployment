/**
 * Returns a promise that resolves in a specified amount of milliseconds
 * @param {number} ms
 */
export default function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
