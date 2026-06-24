import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "test"];
const tsFiles = [];
let tsxCount = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path);
    } else if (path.endsWith(".ts")) {
      tsFiles.push(path);
    } else if (path.endsWith(".tsx")) {
      tsxCount += 1;
    }
  }
}

for (const root of roots) walk(root);

for (const file of tsFiles) {
  execFileSync(process.execPath, ["--experimental-strip-types", "--check", file], {
    stdio: "inherit",
  });
}

console.log(`Checked ${tsFiles.length} .ts files.`);
if (tsxCount > 0) {
  console.log(`Skipped ${tsxCount} .tsx files: Node --check does not support TSX without a compiler.`);
}
