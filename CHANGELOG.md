# Changelog

All notable changes to `homebridge-bosch-nefit-easy` will be documented here.

## [2.0.1] - 2026-05-30

### Added
- **Hot Water Switch** — toggle domestic hot water on/off from HomeKit
- **Manual / Schedule Mode Switch** — switch between manual temperature control and the thermostat's built-in weekly schedule
- **Holiday Mode Indicator** — read-only switch showing whether Holiday Mode is active
- **Home / Away Occupancy Sensor** — shows home/away status; useful for HomeKit automations
- **Outdoor Temperature Sensor** — displays outdoor temperature (requires outdoor sensor fitted to thermostat)
- **Hot Water Temperature Sensor** — displays the current hot water tank temperature
- All new features are **opt-in** — each enabled individually under **Optional Features** in the plugin settings

### Changed
- `TargetHeatingCoolingState` now shows **Off** when the room is at or above the setpoint, and **Heat** only when the room actually needs warming — fixes the misleading "Heat to 15°" label

## [1.0.8] - 2026-05-30

### Added
- **Hot Water Switch** — toggle domestic hot water on/off from HomeKit
- **Manual / Schedule Mode Switch** — switch between manual temperature control and the thermostat's built-in weekly schedule
- **Holiday Mode Indicator** — read-only switch showing whether Holiday Mode is active on the thermostat
- **Home / Away Occupancy Sensor** — shows whether the thermostat considers the home occupied or away; useful for automations
- **Outdoor Temperature Sensor** — displays outdoor temperature (requires an outdoor sensor connected to the thermostat)
- **Hot Water Temperature Sensor** — displays the current hot water tank temperature
- All new features are **opt-in** — each can be individually enabled in the plugin settings under **Optional Features**

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
