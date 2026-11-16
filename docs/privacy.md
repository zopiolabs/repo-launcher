# Privacy

Repo Launcher stores repository links, custom titles, and order in your browser's local extension storage. Counts are cached in session storage for up to five minutes. There is no analytics service, backend, account connection, or token prompt.

When the popup or sidebar is open, the extension uses a signed-in GitHub tab in that browser window to request the saved repositories' PR, issue, and Dependabot pages. These read-only requests use the existing GitHub session. The extension does not read password or cookie values. It does not change repositories, issues, PRs, or alerts.

Only counts, timestamps, and failure categories are passed back to the interface. Page contents and authentication credentials are not stored in the extension or sent to another service. Counts currently support github.com; other hosts retain navigation shortcuts.

The extension needs local storage, github.com site access, and, in Chrome, the side panel permission. Firefox uses its native sidebar. Browser profiles and Chrome/Firefox installations keep separate saved data.

GitHub can change its web markup. If a count cannot be identified or access is missing, the badge shows `—` rather than assuming zero.
