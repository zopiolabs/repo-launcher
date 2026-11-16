# Repo Launcher

A compact repo list for Chrome and Firefox. Search, drag to reorder, rename, or keep it open in the sidebar. No GitHub token required.

**[Download Chrome](https://github.com/zopiolabs/repo-launcher/releases/latest/download/repo-launcher-chrome.zip)** · **[Download Firefox](https://github.com/zopiolabs/repo-launcher/releases/latest/download/repo-launcher-firefox.zip)**

## Chrome

1. Download the Chrome ZIP and extract it to a permanent folder.
2. Open `chrome://extensions`, enable **Developer mode**, then **Load unpacked** → select that folder.

Pin Repo Launcher from Chrome's extensions menu. Use the pin icon inside the extension for its sidebar.

## Firefox

1. Download the Firefox ZIP and extract it.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `manifest.json`.

This unsigned Firefox build lasts until Firefox restarts. Permanent installation requires Mozilla signing.

## GitHub badges

Allow GitHub site access and keep a signed-in GitHub tab open in the same window. Reload that tab once after installing, then click refresh.

- **Green PR:** open pull requests, excluding Dependabot.
- **Blue Issue:** open issues.
- **Red Security:** open Critical + High Dependabot alerts.

Zero hides the badge and grays out the icon. `—` means unavailable. Data stays in your browser; no token, tracking, or external server. [Privacy details](docs/privacy.md).

## Update

Replace the files in the same installed folder, then reload the extension and your GitHub tab. Saved repositories stay in place.

## Development

Node.js 22+; no dependencies to install.

```sh
npm run build
npm test
npm run package
```

Edit `src/`; `chrome/` and `firefox/` are generated and committed so a source download also works without building. Use `platform/` for browser-specific sidebar code. Both builds get their version from `package.json`.

CI checks both browsers. Push a `v<version>` tag to publish tested ZIPs to Releases.
