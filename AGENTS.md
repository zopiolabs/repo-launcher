# Development

- Write identifiers, comments, fixtures, and developer documentation in English.
- Edit shared browser code in `src/` and sidebar adapters in `platform/`.
- Run `npm run build` after source changes. Commit the generated `chrome/` and `firefox/` folders together.
- Run `npm test` before publishing changes.
- `package.json` is the version source for both browsers. Tag releases as `v<version>`.
- Keep installation instructions short. Do not imply the unsigned Firefox package is permanently installed.
