"use strict";

const path = require("node:path");
const {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "..");
const cases = [
  ["verify-browser-parity.cjs"],
  ["verify-extension.cjs"], ["verify-extension.cjs", "--firefox"],
  ["verify-github-counts.cjs"], ["verify-github-counts.cjs", "--firefox"],
  ["verify-badges.cjs"], ["verify-badges.cjs", "--firefox"],
  ["verify-panel.cjs"], ["verify-firefox-panel.cjs"]
];
for (const [file, ...args] of cases) {
  const result = spawnSync(process.execPath, [path.join(root, "tests", file), ...args], {cwd: root, stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("All browser regression checks passed.");
