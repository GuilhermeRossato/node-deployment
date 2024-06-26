import fs from "node:fs";
import getDateTimeString from "../utils/getDateTimeString.js";

let addSource = true;
let addPid = true;
let addDate = true;
let addHour = true;
let addPrefix = [];

/**
 *
 * @param {boolean} [source]
 * @param {boolean} [pid]
 * @param {boolean} [date]
 * @param {boolean} [hour]
 * @param {string | any[]} [prefix]
 */
export function configLog(source, pid, date, hour, prefix) {
  addSource = source === undefined ? addSource : source;
  addPid = pid === undefined ? addPid : pid;
  addDate = date === undefined ? addDate : date;
  addHour = hour === undefined ? addHour : hour;
  addPrefix =
    prefix === undefined ? addPrefix : typeof prefix === "string" ? [prefix] : prefix instanceof Array ? prefix : [];
}

/**
 * @param {string} method
 * @param {string | undefined | null} [logFilePath]
 * @returns
 */
export default function attachToConsole(method = "log", logFilePath = "", hidePrefix = false) {
  const originalMethod = console[method].bind(console);

  let inside = false;
  const handleCall = (...args) => {
    if (inside) {
      return originalMethod(...args);
    }
    inside = true;
    let pcount = 0;
    try {
      if (addPid) {
        pcount++;
        args.unshift(`${process.pid} -`);
      }
      if (addSource) {
        const stackFileList = new Error("a").stack
          .split("\n")
          .map((a) =>
            a
              .substring(Math.max(a.lastIndexOf("\\"), a.lastIndexOf("/")) + 1, a.lastIndexOf(":"))
              .replace(")", "")
              .trim()
          )
          .filter((a) => (a.includes(".js:") || a.includes(".cjs:")) && !a.includes(attachToConsole.name));
        let src = stackFileList.slice(0, 1).reverse().join(" -> ");
        if (!src) {
          src = "?";
        }
        pcount++;
        args.unshift(`${addDate || addHour ? "- " : ""}${src} -`);
      }
      const [date, hour] = getDateTimeString().substring(0, 23).split(" ");
      if (addHour) {
        pcount++;
        args.unshift(hour);
      }
      if (addDate) {
        pcount++;
        args.unshift(date);
      }
      if (addPrefix && addPrefix.length) {
        pcount++;
        args.unshift(...addPrefix.map((e) => (e instanceof Function ? e() : e)));
      }
      if (logFilePath) {
        let text;
        try {
          text = args
            .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack : JSON.stringify(a)))
            .join(" ");
        } catch (err) {
          text = args
            .map((a) => {
              try {
                typeof a === "string" ? a : a instanceof Error ? a.stack : JSON.stringify(a);
              } catch (err) {
                return "(failed to stringify)";
              }
            })
            .join(" ");
        }
        try {
          fs.appendFileSync(logFilePath, `${text}\n`, "utf-8");
        } catch (err) {
          // Ignore
        }
      }
      if (false || (hidePrefix && pcount)) {
        args = args.slice(pcount);
      }
      originalMethod(...args);
      inside = false;
    } catch (err) {
      originalMethod(`\n\nLogging failed:\n${err.stack}\n\n`);
      inside = false;
    }
  };

  console[method] = handleCall;

  return originalMethod;
}
