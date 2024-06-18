/**
* Asynchronously attempts to execute a promise and returns the result.
* If an error is thrown with a code of 'ENOENT', null is returned instead.
* @template ResponseType
* @param {Promise<ResponseType>} promise
* @returns {Promise<ResponseType | null | Error>}
*/
export default async function asyncTryCatchNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    return err;
  }
}