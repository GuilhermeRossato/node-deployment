const debugReq = true;

export function getManagerHost(target = "manager") {
  let host = target === "manager" ? process.env.INTERNAL_DATA_SERVER_HOST || "127.0.0.1" : "127.0.0.1";
  let port = target === "manager" ? process.env.INTERNAL_DATA_SERVER_PORT || "49737" : "49738";
  let hostname = `http://${host}:${port}/`;
  if (typeof target === "string" && (target.startsWith("http://") || target.startsWith("https://"))) {
    debugReq && console.log("Request target hostname set to", JSON.stringify(target));
    hostname = target;
    const startHost = hostname.indexOf("//") + 2;
    if (hostname.indexOf(":", 7) !== -1) {
      host = hostname.substring(startHost, hostname.indexOf(":", 7));
      port = hostname
        .substring(hostname.indexOf(":", 7) + 1, hostname.indexOf("/", 7) + 1 || hostname.length)
        .replace(/\D/g, "");
    } else if (hostname.indexOf("/", 7) !== -1) {
      host = hostname.substring(startHost, hostname.indexOf("/", 7));
      port = "80";
    } else {
      host = hostname.substring(startHost, hostname.length);
      port = "80";
    }
  }
  if (!hostname.endsWith("/")) {
    hostname = `${hostname}/`;
  }
  return { host, port, hostname };
}

/**
 * @param {string} target
 * @param {string} type
 * @param {any} data
 */
export async function sendInternalRequest(target = "manager", type = "", data = null) {
  const { hostname } = getManagerHost(target);
  const url = `${hostname}api/${type}`;
  let stage = "start";
  let status = 0;
  let body = "";
  try {
    stage = "network";
    const isPostOnlyType = ["shutdown", "terminate", "stop"].includes(type);
    const response = await fetch(url, {
      method: data || isPostOnlyType ? "POST" : "GET",
      body: data && typeof data === "object" ? JSON.stringify(data) : isPostOnlyType ? "{}" : undefined,
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
    if (type === "shutdown" && stage === "network") {
      return {
        success: true,
        reason: "Server is not executing (no connection)",
        hostname,
      };
    }
    if (status === 0 && body === "") {
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
