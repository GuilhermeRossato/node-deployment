import http from "node:http";

const stringify = (o) => JSON.stringify(o, null, "  ");

/**
 *
 * @param {string} host
 * @param {string | number} port
 * @param {(url: string, method: string, obj: any) => Promise<any>} handler
 * @returns {Promise<{url: string, server: http.Server}>}
 */
export default async function createInternalDataServer(host, port, handler) {
  const url = `http://${host}:${port}/`;
  const server = await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.on("request", (req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const q = req.url.indexOf("?");
      const url = req.url.substring(0, q === -1 ? req.url.length : q);
      const chunks = [];
      req.on("data", (data) => chunks.push(data));
      req.on("end", async () => {
        try {
          let text = "";
          if (chunks.length && chunks[0]?.length) {
            text = Buffer.concat(chunks).toString("utf-8");
          }
          if (text && (!text.startsWith("{") || !text.includes("}"))) {
            throw new Error(`Invalid request body with ${text.length} bytes`);
          }
          const obj = text ? JSON.parse(text) : null;
          if (q !== -1) {
            const urlArgPairs = req.url
              .substring(q + 1)
              .split("&")
              .map((a) => a.split("="))
              .filter((p) => p[0] && p[1] && !obj[p[0]]);
            for (const [key, value] of urlArgPairs) {
              obj[key.toLowerCase()] = obj[key.toLowerCase()] || value;
            }
          }
          const data = await handler(url, req.method, obj);
          if (!data || typeof data !== "object") {
            throw new Error(
              `Request handler returned invalid data: ${JSON.stringify(data)}`
            );
          }
          res.statusCode = data.error ? 500 : 200;
          res.end(stringify(data));
        } catch (err) {
          res.statusCode = 500;
          res.end(stringify({ error: err.message, stack: err.stack }));
        }
      });
    });
    server.listen(parseInt(port.toString()), host.toString(), () =>
      resolve(server)
    );
  });
  return {
    url,
    server,
  };
}
