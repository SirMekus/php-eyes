# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0]

### Changed

- License changed from MIT to GPL-3.0-only. Versions 0.2.0 and earlier remain available under MIT.

## [0.2.0]

### Added

- Counts are cached per symbol and kept between sessions, so lenses show their last known count straight away and are rechecked in the background.
- Reference lookups are queued and run a few at a time (`phpEyes.maxConcurrentLookups`), with visible symbols first.
- **PHP Eyes: Recount References** command.
- Debug log with per-lookup timings in the **PHP Eyes** output channel.

### Changed

- Saving a PHP file marks counts out of date instead of clearing them, so lenses don't blank out while they're recounted.

## [0.1.1]

### Fixed

- Clicking a lens failed with "Actual command not found" after VS Code re-requested the lenses.

## [0.1.0]

### Added

- First release: "N references" CodeLens above PHP classes, interfaces, enums, methods and functions.
