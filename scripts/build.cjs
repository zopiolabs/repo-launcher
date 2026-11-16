"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Use a three-part numeric version in package.json.");
const files = ["popup.html", "popup.css", "popup.js", "badges.js", "github-counts.js", "github-reader.js"];

for (const browser of ["chrome", "firefox"]) {
  const destination = path.join(root, browser);
  fs.mkdirSync(destination, {recursive: true});
  for (const file of files) {
    let content = fs.readFileSync(path.join(root, "src", file), "utf8");
    if (browser === "firefox" && file.endsWith(".js")) content = content.replaceAll("chrome.", "browser.");
    fs.writeFileSync(path.join(destination, file), content);
  }
  fs.cpSync(path.join(root, "src/icons"), path.join(destination, "icons"), {recursive: true});
  fs.copyFileSync(path.join(root, "platform", browser, "panel.js"), path.join(destination, "panel.js"));
  fs.copyFileSync(path.join(root, "docs", `install-${browser}.md`), path.join(destination, "README.md"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "src/manifest.json"), "utf8"));
  manifest.version = version;
  if (browser === "firefox") {
    delete manifest.minimum_chrome_version;
    delete manifest.side_panel;
    manifest.permissions = ["storage"];
    manifest.browser_specific_settings = {gecko: {
      id: "repo-launcher@extensions.local",
      strict_min_version: "140.0",
      data_collection_permissions: {required: ["none"]}
    }};
    manifest.sidebar_action = {
      default_title: "Repo Launcher",
      default_panel: "popup.html?view=panel",
      default_icon: manifest.action.default_icon,
      open_at_install: false
    };
  }
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(`Built Chrome and Firefox ${version}.`);
