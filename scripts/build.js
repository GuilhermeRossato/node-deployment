import fs from "fs";
import path from "path";
import attachToConsole, { configLog } from "../src/lib/attachToConsole.js";

const addLogToFunctionStart = false;

/**
 * @typedef {Object} InputFileState
 * @property {string} filePath
 * @property {string} sourceCode
 * @property {Record<string, any[]>} lists
 */

/**
 * @param {string} filePath
 * @param {string} sourceCode
 * @param {Record<string, any[]>} lists
 * @returns {InputFileState}
 */
function createState(filePath = "index.js", sourceCode = "", lists = {}) {
  ["imports", "exports", "declared", "undeclared"].map(
    (a) => (lists[a] = lists[a] || [])
  );
  sourceCode = sourceCode.trim().replace(/\r/g, "");
  return { filePath, sourceCode, lists };
}

configLog(true, false, false, false);
attachToConsole("log", null);

/**
 * @typedef {{name: string;fileName: string;filePath: string;stat: fs.Stats;state?: InputFileState; after: string[]}} ProcessedInputUnit
 */

async function init() {
  const root = await guessRootProjectPath();
  const jsconfigText = await fs.promises.readFile(
    path.resolve(root, "jsconfig.json"),
    "utf-8"
  );
  /** @type {ProcessedInputUnit[]} */
  const workload = [];
  try {
    const i = jsconfigText.indexOf('"files": [');
    const j = jsconfigText.indexOf("]", i);
    const fileTexts =
      i !== -1 && j !== -1 ? jsconfigText.substring(i + 10, j) : "";
    const files = JSON.parse("[" + fileTexts + "]");
    for (const file of files) {
      const filePath = path.resolve(root, file).replace(/\\/g, "/");
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        throw new Error(`Invalid folder target: ${JSON.stringify(target)}`);
      }
      workload.push({
        name: `.${filePath.substring(root.length)}`,
        fileName: path.basename(filePath),
        filePath,
        stat,
        state: undefined,
      });
    }
  } catch (err) {
    err.message = `Could not find read entry files for building: ${err.message}`;
    throw err;
  }
  if (workload.length === 0) {
    throw new Error("Could not find any entry files for building");
  }
  console.log(
    "Starting build from:",
    workload.map((a) => a.fileName)
  );
  /**
   * @type {Record<string, ProcessedInputUnit>}
   */
  const filePathRecord = {};
  while (workload.length) {
    const u = workload.shift();
    if (!u) {
      break;
    }
    if (filePathRecord[u.filePath]) {
      continue;
    }
    const text = await fs.promises.readFile(u.filePath, "utf-8");
    u.state = createState(u.filePath, text);
    u.state.sourceCode = convertImportToCommonJS(u.state);
    u.state.sourceCode = convertExportToCommonJS(u.state);
    u.state.sourceCode = convertAssignsToGlobal(u.state);
    u.after = [];
    for (const imp of u.state.lists.imports) {
      if (imp.isModule) {
        continue;
      }
      if (
        imp.isFile &&
        imp.expression.startsWith('require(".') &&
        imp.expression.endsWith('.js")')
      ) {
        const arg = imp.expression.substring(9, imp.expression.length - 2);
        const filePath = path
          .resolve(path.dirname(u.state.filePath), arg)
          .replace(/\\/g, "/");
        const stat = await fs.promises.stat(filePath);
        u.after.push(filePath);
        workload.push({
          name: `.${filePath.substring(root.length)}`,
          fileName: path.basename(filePath),
          filePath: filePath,
          stat,
          state: undefined,
        });
        continue;
      }
    }
    filePathRecord[u.filePath] = u;
  }
  const uniques = Object.values(filePathRecord);
  if (!uniques.length) {
    throw new Error("Could not find a single file to join");
  }
  if (uniques.length === 0) {
    throw new Error("Could not find multiple files to join");
  }
  const filtered = uniques.filter((a) => a.fileName !== "asleep.js");
  const text = await joinProcessedInputFiles(filtered);
  await fs.promises.writeFile(
    path.resolve(root, "node-deploy.cjs"),
    text,
    "utf-8"
  );
  if (process.argv.includes("--watch")) {
    console.log("Started watching", filtered.length, "source files for updates");
    while (true) {
      let i = 0;
      let found = false;
      const updated = filtered.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      for (i = 0; i < updated.length && !found; i++) {
        try {
          const s = await fs.promises.stat(updated[i].filePath);
          found =
            s.mtimeMs !== updated[i].stat.mtimeMs ||
            s.size !== updated[i].stat.size;
        } catch (err) {
          found = true;
        }
      }
      if (found) {
        console.log("Detected update at", updated[i]?.filePath);
        return await init();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
/**
 * @param {ProcessedInputUnit[]} workload
 */
async function joinProcessedInputFiles(workload) {
  let parts = [];
  // Module imports
  for (const unit of workload) {
    for (const imp of unit.state.lists.imports) {
      if (!imp.isModule) {
        continue;
      }
      const line = `const ${imp.varName} = require("node:${imp.varName}");`;
      if (!parts.includes(line)) {
        parts.unshift(line);
      }
      let ind = unit.state.sourceCode.indexOf(imp.commonjsLine);
      if (ind === -1) {
        ind = unit.state.sourceCode.indexOf(
          imp.commonjsLine.replace("const ", "global.")
        );
      }
      if (ind === -1) {
        throw new Error(
          `${unit.name} imports "${imp.varName}" but it was not found at source`
        );
      }
      const next = unit.state.sourceCode.indexOf("\n", ind + 2);
      unit.state.sourceCode =
        unit.state.sourceCode.substring(0, ind) +
        unit.state.sourceCode.substring(
          next === -1 ? unit.state.sourceCode.length : next
        );
    }
  }
  parts = parts.sort((a, b) => a.length - b.length);
  // Flatten exports
  for (const unit of workload) {
    for (const exp of unit.state.lists.exports) {
      const linePrefix = exp.commonjsLine.substring(
        0,
        exp.commonjsLine.indexOf(" = ") + 3
      );
      let ind = unit.state.sourceCode.indexOf(linePrefix);
      if (ind === -1) {
        throw new Error(
          `${unit.name} exports "${exp.varName}" but it was not found at source`
        );
      }
      const next = ind + linePrefix.length;
      unit.state.sourceCode =
        unit.state.sourceCode.substring(0, ind) +
        unit.state.sourceCode.substring(
          next === -1 ? unit.state.sourceCode.length : next
        );
    }
  }
  // Remove requires
  for (let i = 0; i < workload.length; i++) {
    const unit = workload[i];
    for (const imp of unit.state.lists.imports) {
      if (imp.isModule) {
        continue;
      }
      const linePrefix = imp.commonjsLine.substring(0, imp.commonjsLine.length);
      let ind = unit.state.sourceCode.indexOf(linePrefix);
      if (ind === -1) {
        throw new Error(
          `${unit.name} exports "${exp.varName}" but it was not found at source`
        );
      }
      const next =
        ind +
        linePrefix.length +
        (unit.state.sourceCode[ind + linePrefix.length] === ";" ? 1 : 0);
      unit.state.sourceCode =
        unit.state.sourceCode.substring(0, ind) +
        unit.state.sourceCode.substring(
          next === -1 ? unit.state.sourceCode.length : next
        );
    }
  }
  const sorted = workload.sort((a, b) => {
    if (a.after.find((c) => c === b.filePath)) {
      return 1;
    }
    if (b.after.find((c) => c === a.filePath)) {
      return -1;
    }
    let va = a.after.length;
    let vb = b.after.length;
    if (va === vb) {
      va = a.name.length;
      vb = b.name.length;
    }
    if (va !== vb) {
      return va > vb ? 1 : -1;
    }
    return 0;
  });
  parts.push("");
  for (const unit of sorted) {
    parts.push("// " + unit.name + "");
    parts.push(unit.state.sourceCode.trim());
  }
  const text = parts.join("\n");
  // console.log(`text`, text);
  //await fs.promises.writeFile("../node-deploy.js", text, "utf-8");
  return text;
}

async function guessRootProjectPath() {
  for (const option of [
    ".",
    "..",
    "./node-project-deployment-manager",
    "./node-project-deployment-manager-master",
    "./node-deployment-manager-master",
    "./node-deployment-master",
  ]) {
    const dir = path.resolve(option);
    let files = [];
    try {
      files = await fs.promises.readdir(dir);
    } catch (err) {
      console.log(dir, err);
      continue;
    }
    if (!files.includes("jsconfig.json")) {
      continue;
    }
    if (!files.includes("package.json")) {
      continue;
    }
    return dir.replace(/\\/g, "/");
  }
  throw new Error("Could not find root project path");
}
/**
 * @param {InputFileState} state
 */
function convertAssignsToGlobal(state) {
  const lines = state.sourceCode.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const part = lines[i];
    if (!part.startsWith("const ") && !part.startsWith("let ")) {
      continue;
    }
    const start = part.indexOf(" ");
    const objSep = part.indexOf(" = ", start);
    if (objSep === -1) {
      continue;
    }
    const varName = part.substring(start + 1, objSep);
    const endExp = part.indexOf(";", objSep + 3);
    const expression = part.substring(
      objSep + 3,
      endExp === -1 ? part.length : endExp
    );

    const imp = state.lists.imports.find(
      (e) => e.expression.replace(";", "") === expression.replace(";", "")
    );
    if (imp) {
      continue;
    }
    const moduleLine = `const ${varName} = ${expression}`;
    const commonjsLine = `global.${varName} = ${expression}`;
    const callIndexStart = part.indexOf("(", objSep);
    const callIndexEnd =
      callIndexStart === -1 ? -1 : part[endExp - 1] === ")" ? endExp - 1 : -1;
    const callArg =
      callIndexEnd !== -1
        ? part.substring(callIndexStart + 1, callIndexEnd)
        : "";
    state.lists.declared.push({
      varName,
      expression,
      moduleLine,
      commonjsLine,
      isFunction: expression.replace("async ", "").startsWith("function "),
      isObject: expression.startsWith("{"),
      isString: expression.startsWith('"'),
      isArray: expression.startsWith("["),
      isBool: expression.startsWith("true") || expression.startsWith("false"),
      callArg,
      isRequireModule: expression.startsWith('require("'),
      isRequireFile: expression.startsWith('require(".'),
    });
    lines[i] = "global." + commonjsLine.substring("global.".length);
  }
  return lines.join("\n");
}
/**
 * @param {InputFileState} state
 */
function convertImportToCommonJS(state) {
  return `\n${state.sourceCode}`
    .split("\nimport ")
    .map((part, i) => {
      const s = part.indexOf(" from ");
      const quote = part[s + 6] || "";
      if (i === 0 || s === -1 || !['"', "'", "`"].includes(quote)) {
        return part;
      }
      const varName = part.substring(0, s);
      const end = part.indexOf(quote, s + 6 + 1);
      const str = part.substring(s + 6, end + 1);
      if (str.includes("\n")) {
        state.lists.problems.push(`Invalid str "${str}"`);
        return part;
      }
      const expression = `require(${str})`;
      const commonjsLine = `const ${varName} = ${expression}`;
      const moduleLine = `import ${part.substring(0, end + 1)}`;
      state.lists.imports.push({
        varName,
        expression,
        moduleLine,
        commonjsLine,
        isFile: str[0] === "." || str.includes(".js"),
        isModule: str[0] !== "." && !str.includes(".js"),
      });
      return commonjsLine.substring(6) + part.substring(end + 1);
    })
    .join("\nconst ")
    .trim();
}
/**
 * @param {ReturnType<createState>} state
 */
function convertExportToCommonJS(state) {
  return `\n${state.sourceCode.trim().replace(/\r/g, "")}`
    .split("\nexport ")
    .map((part, i) => {
      const nl = part.indexOf("\n");
      const end = nl;
      if (end <= 0) {
        return part;
      }
      const isDefault = part.startsWith("default ");
      const subject = part.substring(isDefault ? 8 : 0, nl);

      const moduleLine = `export ${subject}`;
      const isFunction =
        subject.startsWith("async function ") ||
        subject.startsWith("function ");
      if (!isFunction) {
        throw new Error(
          `Only function exports are allowed, got invalid export at: ${JSON.stringify(
            state.filePath
          )}`
        );
      }
      const funcIndex = subject.indexOf("function ");
      const openIndex = subject.indexOf("(");
      const closeIndex = subject.indexOf(")", openIndex);
      const varName = subject.substring(funcIndex + 9, openIndex).trim();
      if (varName.includes(" ")) {
        state.lists.problems.push(
          `Invalid expression "${varName}" at line "${moduleLine}"`
        );
      }
      const prefix = `exports${isDefault ? " = " : `.${varName} = `}`;
      const middle = subject.substring(0, nl);
      const sufix = part.substring(nl);
      let updated = prefix + middle + sufix;
      state.lists.exports.push({
        varName,
        expression: subject.trim(),
        moduleLine: moduleLine,
        commonjsLine: `module.${prefix}${middle}`,
        isFunction,
        isDefault,
      });
      const bodyOpen = updated.indexOf("{");
      if (
        addLogToFunctionStart &&
        closeIndex !== -1 &&
        bodyOpen > closeIndex &&
        updated.substring(bodyOpen + 1, bodyOpen + 4) === "\n  "
      ) {
        const before = updated.substring(0, bodyOpen + 4);
        const newLine = `console.log(${JSON.stringify(
          `[${varName}(${openIndex + 1 === closeIndex ? "" : "..."})]`
        )}, ${JSON.stringify(path.basename(state.filePath))});`;
        updated = `${before}${newLine}\n${updated.substring(bodyOpen + 2)}`;
      }
      return updated;
    })
    .join("\nmodule.")
    .trim();
}
init().catch((err) => {
  console.log(err);
  process.exit(1);
});
