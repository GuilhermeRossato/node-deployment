import path from "path";
import { getCurrentStackList } from "./getCurrentStackList.mjs";
import { persistLog } from "./persistLog.mjs";

let persistFilePath = "";

export function setPersistFilePath(p) {
  persistFilePath = p;
}

export function getPersistFilePath() {
  return persistFilePath;
}

export function attachToProcessLog() {
  const original = console.log;
  let persisting = false;
  let persistError = persistFilePath ? null : new Error("Persist disabled");
  let persistTimer = null;
  let persistBuffer = [];
  const handlePersistTimer = () => {
    if (persisting) {
      return;
    }
    if (persistBuffer.length === 0 || persistError) {
      clearInterval(persistTimer);
      persistTimer = null;
      return;
    }
    const list = persistBuffer.shift();
    persisting = true;
    persistLog(persistFilePath, ...list).then((err) => {
      persisting = false;
      if (!persistError && err) {
        persistError = err;
        process.stdout.write(
          `\nPersisting failed: ${
            err && err.stack
              ? err.stack
              : err && err.message
              ? err.message
              : err
          }\n`
        );
      }
    });
  };
  let depth = 0;
  console.log = (...args) => {
    if (depth > 3) {
      return original.call(console, ...args);
    }
    depth++;
    let r;
    try {
      const prefix = [
        new Date().toISOString(),
        (() => {
          const list = getCurrentStackList();
          const isFirstAttach = list[0] && path.basename(list[0].source).includes(attachToProcessLog.name);
          if (isFirstAttach) {
            list.shift();
          }
          const isSecondAttach = isFirstAttach && list[0] && path.basename(list[0].source).includes(attachToProcessLog.name);
          if (isSecondAttach) {
            list.shift();
          }
          const i = list.length - 1;
          const lasts = [0, -1]
            .map((off) => {
              const elem = list[i + off];
              if (!elem) {
                return;
              }
              const base = path.basename(elem.source);
              const name = base.includes(":")
                ? base.substring(0, base.lastIndexOf(":"))
                : base;
              return name;
              return `${i + off}/${list.length} ${name} (${JSON.stringify(elem.method)})`;
            })
            .filter(Boolean);
          return `- ${lasts.join(" > ")} -`;
        })(),
        process.pid,
        "-",
      ];
      const updated = [...prefix, ...args];
      if (!persistError) {
        persistBuffer.push(updated);
        if (!persistTimer) {
          persistTimer = setInterval(handlePersistTimer, 20);
        }
      }
      r = original.call(console, ...updated);
    } catch (err) {
      persistError = err;
      r = original.call(console, err);
    }
    depth--;
    return r;
  };
  return original;
}
