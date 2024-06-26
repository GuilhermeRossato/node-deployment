import getDateTimeString from "../utils/getDateTimeString.js";

let lastDatePrinted = "";
export function outputDatedLine(prefix, date, ...args) {
  let dateStr = "";

  if (typeof date === "string" && !date.startsWith("2") && !date.startsWith("1")) {
    dateStr = date;
    if (dateStr.length > 20) {
      dateStr = dateStr.substring(0, 20);
    }
    if (dateStr.length < 17) {
      dateStr = `| ${dateStr} |`;
    } else if (dateStr.length < 19) {
      dateStr = `|${dateStr}|`;
    }
    while (dateStr.length < 19) {
      dateStr = ` ${dateStr} `;
    }
  } else {
    dateStr = date ? getDateTimeString(date).substring(0, 19) : "";
    const [yyyymmdd, hhmmss] = dateStr.split(" ");
    if (yyyymmdd && hhmmss && lastDatePrinted.startsWith(yyyymmdd)) {
      dateStr = hhmmss;
      lastDatePrinted = lastDatePrinted.substring(0, lastDatePrinted.length - 1);
    } else {
      lastDatePrinted = dateStr;
    }
  }
  if (dateStr.length !== 20) {
    dateStr = dateStr.substring(0, 20).padStart(20, " ");
  }
  const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  process.stdout.write(`${prefix + dateStr} ${text}\n`);
}

export function outputLogEntry(prefix, obj) {
  if (process.stdout && process.stdout.columns >= 60) {
    const right = `PID: ${obj.pid.toString()}`;
    const s = process.stdout.columns - right.length - 2;
    process.stdout.write(`${" ".repeat(s) + right}\r`);
  }
  outputDatedLine(`[${prefix}]`, obj.time, " " + obj.src, "-", obj.pid.toString(), "-", obj.text);
  return obj.time;
}
