
export async function asyncTryCatchNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return null;
    }
    return err;
  }
}
