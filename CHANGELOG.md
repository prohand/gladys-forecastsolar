# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.2.1] - 2026-10-08

### Security

- The house coordinates are masked (`***`) in the Forecast.Solar request URL written to the debug logs, like the API key already was.

### Fixed

- Several houses no longer exhaust the Forecast.Solar quota (12 requests/hour/IP): the download interval is lengthened automatically to stay under 10 requests/hour for all houses together; the configured interval remains the minimum.
- After a "request limit reached" answer, the integration waits until the time Forecast.Solar gives (for every house) instead of retrying 15 minutes later.
- The **Refresh the forecast now** button reuses a forecast downloaded less than 5 minutes ago, and sends no request while the limit is reached.
- A forecast downloaded by a scene action, a widget or the "Refresh the forecast now" button now fires the "Solar forecast updated" trigger (on the next refresh).
- A failed read of the Gladys houses is retried after a minute instead of an hour.
- The estimated power is no longer published as 0 W up to 24 hours after the end of the forecast: past its last point (plus one hour) it is unknown.
- After a disconnection the refresh loop pauses, and an updated device gets all its values again, like a created one.

### Changed

- Values are published when they change, or every 30 minutes, instead of every 5 minutes: a much smaller history in Gladys.
- Node.js 22 or later is required (the Docker image ships Node 24).
- CI tests on Node 22 and 24 and builds the Docker image on pull requests; Dependabot also follows the Docker base image.

## [1.2.0] - 2026-10-07

### Fixed

- A widget answers before Gladys gives up on it: it shows the forecast in memory, downloads only for a house that has none yet, and shows a loading card past 9 s.
- Each production moment (start, peak, end) fires its scene trigger once a day, even when a new forecast moves it a little.

### Changed

- CI runs the store admission checks on pull requests; Dependabot keeps the dependencies and GitHub Actions up to date; a GitHub Release is published for every version.

## [1.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Manifest re-formatted with Prettier, so the CI format check passes again.

### Fixed

- The forecast, its values and the production scene triggers are refreshed again after the device is created: devices are published with `should_poll: true`, without which Gladys never polls them, and an integration-owned loop refreshes the devices created before that flag.
- The Release workflow re-runs Prettier on the manifest after `jq`, so a release no longer leaves `main` with a failing CI format check.

## [1.0.1] - 2026-10-02

First public release.

### Added

- Forecast.Solar external integration for Gladys
- Houses from Gladys, dashboard widgets, scene triggers and actions

### Fixed

- Peak power typed in Wp so the Gladys form accepts it

[Unreleased]: https://github.com/prohand/gladys-forecastsolar/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/prohand/gladys-forecastsolar/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/prohand/gladys-forecastsolar/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/prohand/gladys-forecastsolar/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-forecastsolar/releases/tag/v1.0.1
