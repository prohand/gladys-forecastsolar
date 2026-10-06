# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Manifest re-formatted with Prettier, so the CI format check passes again.

## [1.0.1] - 2026-10-02

First public release.

### Added

- Forecast.Solar external integration for Gladys
- Houses from Gladys, dashboard widgets, scene triggers and actions

### Fixed

- Peak power typed in Wp so the Gladys form accepts it

[Unreleased]: https://github.com/prohand/gladys-forecastsolar/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-forecastsolar/releases/tag/v1.0.1
