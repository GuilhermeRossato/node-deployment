
/**
 * @param {string} target
 * @param {string} type
 * @param {any} data
 */
export default async function sendInternalRequest(target = 'manager', type = "", data = null) {
  const host = target === 'manager' ? process.env.INTERNAL_DATA_SERVER_HOST || '127.0.0.1' : '127.0.0.1';
  const port = target === 'manager' ? process.env.INTERNAL_DATA_SERVER_PORT || '49737': '49738';
  const hostname = `http://${host}:${port}/`;
  const url = `${hostname}api/${type}`;
  let stage = "start";
  let status = 0;
  let body = "";
  try {
    stage = "network";
    const isPostOnlyType = ["shutdown"].includes(type);
    const response = await fetch(url, {
      method: data || isPostOnlyType ? "POST" : "GET",
      body: data && typeof data === "object" ? JSON.stringify(data) : isPostOnlyType ? '{}' : undefined,
      headers:
        data && typeof data === "object"
          ? {
              "Content-Type": "application/json",
            }
          : {},
    });
    stage = "body";
    status = response.status;
    body = await response.text();
  } catch (err) {
    if (type === 'shutdown' && stage === 'network') {
      return {
        success: true,
        reason: "Server is already deactivated (not in execution)",
        hostname,
      };
    }
    if (status === 0 && body === '') {
      return {
        error: "Internal server request failed",
        stage,
        hostname,
      };
    }
    return {
      error: "Internal server request failed",
      stage,
      status,
      body,
      hostname,
    };
  }
  stage = "data";
  let obj;
  try {
    obj = body ? JSON.parse(body) : "";
  } catch (err) {
    return {
      error: "Internal server response interpretation failed",
      stage,
      status,
      body,
      hostname,
    };
  }
  stage = "response";
  if (obj && typeof obj === "object" && status !== 200) {
    obj.status = status;
  }
  return obj;
}
