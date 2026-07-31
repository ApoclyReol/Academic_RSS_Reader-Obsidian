import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const localeKeys = async (file) => {
  const source = await readFile(file, "utf8");
  const object = source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1);
  return new Set(Object.keys(JSON.parse(object)));
};
const en = await localeKeys(path.join(root, "src/locales/en.ts"));
const zh = await localeKeys(path.join(root, "src/locales/zh-CN.ts"));
const missingZh = [...en].filter((key) => !zh.has(key));
const missingEn = [...zh].filter((key) => !en.has(key));
const errors = [];
if (missingZh.length || missingEn.length) {
  errors.push(
    `Locale keys differ. Missing zh-CN: ${missingZh.join(", ")}; missing en: ${missingEn.join(", ")}`,
  );
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target)));
    else if (entry.name.endsWith(".ts") && !target.includes("/locales/"))
      output.push(target);
  }
  return output;
}

const userTextMethods = new Set([
  "setName",
  "setDesc",
  "setTitle",
  "setButtonText",
  "setTooltip",
]);
for (const file of await walk(path.join(root, "src"))) {
  const source = await readFile(file, "utf8");
  if (source.includes("tx(")) {
    errors.push(`${path.relative(root, file)} still calls tx()`);
  }
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      /[\u3400-\u9fff]/.test(node.getText(tree)) &&
      !file.endsWith("rss-parser.ts") &&
      !file.endsWith("recommendation-service.ts")
    ) {
      errors.push(`${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} hard-coded Chinese text`);
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (name === "t" && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!en.has(key)) {
          errors.push(`${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} unknown key ${key}`);
        }
      }
      if (
        userTextMethods.has(name) &&
        (ts.isStringLiteral(node.arguments[0]) ||
          ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
      ) {
        errors.push(`${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} hard-coded UI text`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
if (errors.length) {
  throw new Error(errors.join("\n"));
}
