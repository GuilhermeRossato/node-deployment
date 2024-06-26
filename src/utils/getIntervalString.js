export function getIntervalString(ms) {
  if (typeof ms !== "number" || isNaN(ms)) {
    return "(never)";
  }
  if (ms >= -2000 && ms <= 2000) {
    return `${Math.floor(ms)} ms`;
  }
  const left = ms < 0 ? "-" : "";
  const s = Math.abs(ms / 1000);
  if (s <= 60) {
    return left + (s <= 1.1 ? "1 second" : `${s.toFixed(1)} seconds`);
  }
  const h = Math.floor(s / (60 * 60));
  const m = Math.floor(s / 60);

  if (h <= 0) {
    const right = Math.floor(s) === 0 ? "" : Math.floor(s) === 1 ? "and 1 second" : `and ${Math.floor(s)} seconds`;
    return `${left}${m === 1 ? "1 minute" : `${m} minutes`} ${right}`;
  }
  if (h <= 24) {
    return `${left}${h} hour${h === 1 ? "" : "s"} and ${m} minutes`;
  }
  const days = Math.floor(s / (24 * 60 * 60));
  const sufix = h === 0 ? "" : h === 1 ? "an 1 hour" : ` and ${h} hours`;
  return `${left}${days} ${days === 1 ? "day" : "days"}${sufix}`;
}
