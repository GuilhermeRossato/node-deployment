export function getCurrentStackList() {
  const text = new Error("a").stack.replace(/\\/g, "/").replace(/\r\n/g, "\n");
  const start = `at ${getCurrentStackList.name} (`;
  return text
    .substring(text.indexOf("\n", text.indexOf(start) + 1) + 1)
    .split("\n")
    .map((line) =>
      line.includes(".js") || line.includes(".mjs")
        ? line.replace(/\)/g, "").trim()
        : ""
    )
    .filter((a) => a.length && !a.includes(getCurrentStackList.name))
    .map((line) => line.substring(line.indexOf("at ") + 3).split("("))
    .map((parts) => ({
      source: parts[parts.length - 1],
      method: parts.length === 2 ? parts[0].trim() : "",
    }));
}
