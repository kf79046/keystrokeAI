import doiuse from "doiuse";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

function collectCssFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

const files = [...new Set([".next", "src", "styles"].flatMap(collectCssFiles))];

if (!files.length) {
  console.log("compat:css — no CSS files found (skipping).");
  process.exit(0);
}

const browsers =
  "last 2 Chrome versions, last 2 Firefox versions, last 2 Edge versions, last 2 Safari major versions, iOS >= 15.5";
let warningCount = 0;

for (const file of files) {
  const result = await postcss([doiuse({ browsers })]).process(
    readFileSync(file, "utf8"),
    { from: file }
  );

  for (const warning of result.warnings()) {
    console.error(warning.toString());
    warningCount += 1;
  }
}

if (warningCount > 0) {
  console.error(`compat:css — ${warningCount} compatibility warning(s).`);
  process.exit(1);
}

console.log(`compat:css — checked ${files.length} CSS file(s); no warnings.`);


