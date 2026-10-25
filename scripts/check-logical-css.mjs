// Fails when UI code uses physical left/right instead of logical properties (docs/02-design-system.md 2.3,
// .claude/skills/hebrew-rtl-ui). Run: node scripts/check-logical-css.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dirs = ["packages/ui/src", "apps/extension/src", "apps/extension/entrypoints", "apps/web"];
const rules = [
  [/\b(margin|padding|border|scroll-margin|scroll-padding)-(left|right)\b/, "use the -inline-start/-inline-end form"],
  [/\b(margin|padding|border|scrollMargin|scrollPadding)(Left|Right)\b/, "use the Inline Start/End form"],
  [/(^|[;{\s])(left|right)\s*:/, "use inset-inline-start/end"],
  [/\b(textAlign|text-align)\s*:\s*['"]?(left|right)\b/, "use start/end"],
  [/\bfloat\s*:\s*(left|right)/, "use inline-start/end in a flex or grid layout"],
  [/\bflex-direction\s*:\s*row-reverse|row-reverse/, "flex follows dir; do not use row-reverse to fix RTL"],
];
const exts = new Set([".css", ".tsx", ".html"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".output" || name === ".wxt") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (exts.has(path.slice(path.lastIndexOf(".")))) yield path;
  }
}

let problems = 0;
for (const d of dirs) {
  const full = join(root, d);
  try { statSync(full); } catch { continue; }
  for (const file of walk(full)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      for (const [re, hint] of rules) {
        if (re.test(line)) {
          problems++;
          console.error(`${file.replace(root + "/", "")}:${i + 1}: ${hint}\n    ${line.trim()}`);
        }
      }
    });
  }
}
if (problems) {
  console.error(`\n${problems} physical-direction use(s) found.`);
  process.exit(1);
}
console.log("RTL check passed: no physical left/right in UI code.");
