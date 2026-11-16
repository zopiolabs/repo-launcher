"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const chromeDirectory = "chrome";
const firefoxDirectory = "firefox";
const read = (directory, file) => fs.readFileSync(`${directory}/${file}`, "utf8");
const chromeManifest = JSON.parse(read(chromeDirectory, "manifest.json"));
const firefoxManifest = JSON.parse(read(firefoxDirectory, "manifest.json"));
assert.equal(firefoxManifest.version, chromeManifest.version);
assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "repo-launcher@extensions.local");
assert.deepEqual(firefoxManifest.host_permissions, chromeManifest.host_permissions);
assert.deepEqual(firefoxManifest.content_scripts, chromeManifest.content_scripts);

for (const file of ["popup.html", "popup.css", "github-counts.js"]) {
  assert.equal(read(firefoxDirectory, file), read(chromeDirectory, file), file);
}
for (const file of ["popup.js", "badges.js", "github-reader.js"]) {
  assert.equal(read(firefoxDirectory, file), read(chromeDirectory, file).replaceAll("chrome.", "browser."), file);
}
for (const file of Object.values(chromeManifest.icons)) {
  assert.deepEqual(fs.readFileSync(`${firefoxDirectory}/${file}`), fs.readFileSync(`${chromeDirectory}/${file}`), file);
}
for (const directory of [chromeDirectory, firefoxDirectory]) {
  const html = read(directory, "popup.html");
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(`${directory}/${match[1]}`), match[1]);
  assert.ok(!read(directory, "README.md").includes("undefined"));
}
assert.ok(read(firefoxDirectory, "panel.js").includes("browser.sidebarAction.open()"));
assert.ok(!read(firefoxDirectory, "panel.js").includes("sidePanel"));
console.log(`PASS: Chrome and Firefox ${chromeManifest.version} share the same UI, count rules, GitHub reader, assets and declared scripts; only browser API names and sidebar controls differ.`);
