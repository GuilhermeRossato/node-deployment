
export async function getIntervalStringForSeconds(elapsed) {
  return isNaN(elapsed)
    ? "(never)"
    : s <= 1
    ? `${elapsed.toFixed(0)} ms`
    : s <= 60
    ? `${s.toFixed(1)} seconds`
    : s <= 60 * 60
    ? `${Math.floor(s / 60)} mins and ${Math.floor(s % 1)} seconds`
    : s <= 24 * 60 * 60
    ? `${Math.floor(s / (60 * 60))}:${Math.floor(s / 60) % 1}:${Math.floor(
        s % 1
      )}`
    : `${Math.floor(s / (24 * 60 * 60))} days and ${
        Math.floor(s / (60 * 60)) % 1
      } hours`;
}
