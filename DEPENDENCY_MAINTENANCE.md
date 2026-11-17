# Controlled dependency maintenance

Approved organization policy: 17 November 2026.

## Detection and pull requests

Keep the dependency graph, Dependabot alerts and malware alerts enabled. Automatic Dependabot security PRs are disabled in repository settings. Every ecosystem in .github/dependabot.yml has open-pull-requests-limit: 0, preventing automatic routine PRs. A monthly schedule and minor/patch groups are retained as maintenance metadata; the zero limit means this schedule does not create PRs.

No automatic merge or Dependabot ruleset/branch-protection bypass is permitted. Existing CI and review requirements apply to maintainer-created dependency PRs. Existing infra/core access is governed by the repository's protection rules.

## Security triage

Repository maintainers own the security queue and coordinate with infra/core when shared runtime or deployment dependencies are involved. Review new critical/high alerts promptly, ahead of routine maintenance. Do not postpone actionable critical/high remediation until the monthly batch.

Check the affected version, actual dependency path, runtime/development scope and available patched versions. Open a controlled PR covering the smallest compatible set of fixes. Preserve signature, authorization, tenant and payment invariants. Determine CI, staging and rollback evidence from the change's risk; a one-off testing waiver is not the default policy.

If no patched version exists, keep the alert open and record the upstream advisory and the next review action. Closing a bot PR does not resolve its security alert. Do not dismiss an alert merely to clear the list.

## Monthly maintenance

During the first week of each month, maintainers review current manifests and lockfiles and prepare manual grouped minor/patch PRs. Use the ecosystem directories and compatibility groups recorded in dependabot.yml. Keep runtime, development, mobile-framework and infrastructure updates separated when their compatibility or validation differs. Major upgrades require separate PRs and review.

Regenerate lockfiles with the repository's existing package manager and supported toolchain. Keep unrelated upgrades out of each batch. Record the affected packages, validation and deployment/rollback plan in the PR. After merge, confirm the default branch and dependency graph reflect the intended versions; verify relevant alerts automatically close as Fixed.

This document records a maintainer-led cadence. It does not install a scheduled job, send reminders, update dependencies automatically or deploy applications.

## Existing PR disposition

The owner approved closing all existing Dependabot-authored PRs during adoption of this policy. Their GitHub history remains available. Security remediation is restarted from current alerts using new controlled PRs; routine and major updates are reconsidered during maintenance. Human-authored PRs are outside this cleanup.
