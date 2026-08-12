import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const localeMessages = async (file) => {
  const source = await readFile(file, "utf8");
  const object = source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1);
  return JSON.parse(object);
};
const enMessages = await localeMessages(path.join(root, "src/locales/en.ts"));
const zhMessages = await localeMessages(path.join(root, "src/locales/zh-CN.ts"));
const en = new Set(Object.keys(enMessages));
const zh = new Set(Object.keys(zhMessages));
const missingZh = [...en].filter((key) => !zh.has(key));
const missingEn = [...zh].filter((key) => !en.has(key));
const errors = [];
if (missingZh.length || missingEn.length) {
  errors.push(
    `Locale keys differ. Missing zh-CN: ${missingZh.join(", ")}; missing en: ${missingEn.join(", ")}`,
  );
}
const placeholders = (message) =>
  [...message.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .sort();
for (const key of [...en].filter((entry) => zh.has(entry))) {
  const enPlaceholders = placeholders(enMessages[key]);
  const zhPlaceholders = placeholders(zhMessages[key]);
  if (enPlaceholders.join("\0") !== zhPlaceholders.join("\0")) {
    errors.push(
      `Locale placeholders differ for ${key}. en: ${enPlaceholders.join(", ")}; zh-CN: ${zhPlaceholders.join(", ")}`,
    );
  }
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
const errorConstructors = new Set(["Error", "NonRetryableError"]);
const domTextMethods = new Set(["createEl", "createDiv", "createSpan"]);
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
      if (
        domTextMethods.has(name) &&
        node.arguments[0] &&
        node.arguments.some((argument) =>
          ts.isObjectLiteralExpression(argument) &&
          argument.properties.some((property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(tree) === "text" &&
            (
              ts.isStringLiteral(property.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(property.initializer)
            )
          )
        )
      ) {
        errors.push(`${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} hard-coded DOM text`);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      errorConstructors.has(node.expression.text) &&
      node.arguments?.[0] &&
      (
        ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0]) ||
        ts.isTemplateExpression(node.arguments[0])
      )
    ) {
      errors.push(`${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1} hard-coded user-facing error`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
if (errors.length) {
  throw new Error(errors.join("\n"));
}
