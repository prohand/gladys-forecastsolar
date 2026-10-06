# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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

[Unreleased]: https://github.com/prohand/gladys-forecastsolar/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/prohand/gladys-forecastsolar/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-forecastsolar/releases/tag/v1.0.1
