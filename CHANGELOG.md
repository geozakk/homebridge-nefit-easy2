# Changelog

All notable changes to `homebridge-bosch-nefit-easy` will be documented here.

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
