# Changelog

All notable changes to `homebridge-bosch-nefit-easy` will be documented here.

## [1.0.7] - 2026-05-30

### Changed
- `TargetHeatingCoolingState` now reflects actual need: shows **Off** when the room is at or above the setpoint, and **Heat** only when the room needs warming. Fixes the misleading "Heat to 15°" display when the room is already warmer than the setpoint.

## [1.0.6] - 2026-05-30

### Fixed
- Added `repository`, `bugs`, and `homepage` fields to `package.json` so the Homebridge UI can retrieve the changelog and release notes from GitHub correctly
- Added `author` field (Codzelerate)

## [1.0.5] - 2026-05-30

### Changed
- Manufacturer now shows **Bosch** (clean, no slash) in the Home app
- Firmware version now reflects the installed plugin version (e.g. 1.0.5) instead of 0.0
- Model correctly shows **Nefit Easy**

## [1.0.0] - 2026-05-30

### Added
- Initial release as `homebridge-bosch-nefit-easy` (renamed from `homebridge-nefit-easy2`)
- Homebridge v2 accessory plugin for the Bosch Nefit Easy thermostat
- Uses `bosch-xmpp` library — Node.js 22+ compatible, replaces broken `nefit-easy-core`
- Persistent XMPP connection with automatic reconnect after 30 seconds on failure
- Polling interval configurable via UI (default 60 s)
- HomeKit Thermostat service: CurrentTemperature, TargetTemperature (5–30 °C, step 0.5), CurrentHeatingCoolingState, TargetHeatingCoolingState (Off / Heat)
- Debug logging flag in plugin settings for troubleshooting
- Child bridge support for process isolation
- Homebridge UI X compatible config schema with field descriptions
