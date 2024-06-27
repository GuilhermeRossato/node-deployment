const tzHrOffset = -(new Date().getTimezoneOffset() / 60);
const hhOffset = Math.floor(Math.abs(tzHrOffset)).toString();
const mmOffset = Math.floor(Math.abs(tzHrOffset / 60) % 60)
  .toString()
  .padStart(2, "0");

/**
 * Returns the date time string offseted by the local timezone in YYYY-MM-DD HH:MM:SS.zzz format
 * @param {Date | string | number} date
 * @param {boolean} [includeOffset] (default false) Whether to append the local timezone offset to the end of the date (e.g. " -03:00")
 * @returns {string} "YYYY-MM-DD HH:MM:SS.zzz"
 */
export default function getDateTimeString(date = new Date(), includeOffset = false) {
  // Obs: This function is frequently used
  if (typeof date === "string" && date.startsWith("20") && date[3] === "-" && date[5] === "-") {
    if (date.length === "2024-04-04 04".length) {
      date = date + ":00:00";
    }
    const ending = date.trim().substring(date.length - 7);
    if (!ending.includes("+") && !ending.includes("-") && !ending.includes("Z") && !ending.includes("G")) {
      const guess = new Date(`${date} ${tzHrOffset < 0 ? "-" : ""}${hhOffset.padStart(2, "0")}:${mmOffset}`);
      if (!isNaN(guess.getTime())) {
        date = guess;
      }
    }
  }
  const d = new Date(date instanceof Date ? date.getTime() : date === undefined ? null : date);
  d.setTime(d.getTime() + tzHrOffset * 60 * 60 * 1000);
  const fullYear = d.getUTCFullYear();
  if (isNaN(fullYear)) {
    throw new Error(`Invalid date: ${JSON.stringify(date)}`);
  }
  const year = fullYear.toString().padStart(4, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const seconds = d.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = d.getUTCMilliseconds().toString().padStart(3, "0").substring(0, 3);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}${
    includeOffset ? ` ${tzHrOffset < 0 ? "-" : ""}${hhOffset.padStart(2, "0")}:${mmOffset}` : ""
  }`;
}
