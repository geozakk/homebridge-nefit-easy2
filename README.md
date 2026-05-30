# homebridge-bosch-nefit-easy

Homebridge accessory plugin for the **Nefit Easy** (Bosch EasyControl) thermostat.

This plugin replaces the deprecated `homebridge-nefit-easy` which is broken on Node.js 22+. It uses [`bosch-xmpp`](https://github.com/robertklep/bosch-xmpp) — a modern, maintained implementation of the Bosch XMPP backend protocol.

## Requirements

- [Homebridge](https://homebridge.io) v2.0 or later
- Node.js 22 or 24

## Installation

```bash
npm install -g homebridge-bosch-nefit-easy
```

Or install via the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x) by searching for **homebridge-bosch-nefit-easy**.

## Configuration

Add an accessory entry to your Homebridge `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "BoschNefitEasy",
      "name": "Thermostat",
      "serialNumber": "NEFIT_SERIAL_NUMBER",
      "accessKey": "NEFIT_ACCESS_KEY",
      "password": "NEFIT_PASSWORD",
      "pollingInterval": 60
    }
  ]
}
```

### Options

| Field             | Type    | Required | Default | Description                                        |
|-------------------|---------|----------|---------|----------------------------------------------------|
| `name`            | string  | Yes      | —       | Accessory name shown in HomeKit                    |
| `serialNumber`    | string  | Yes      | —       | Nefit Easy serial number                           |
| `accessKey`       | string  | Yes      | —       | Nefit Easy access key                              |
| `password`        | string  | Yes      | —       | Nefit Easy password                                |
| `pollingInterval` | integer | No       | `60`    | Poll interval in seconds (min 10, max 600)         |

### Finding Your Credentials

Open the **Nefit Easy** app on your phone:

1. Tap the **hamburger menu** (☰) → **Settings** → **About**
2. Your **Serial number** and **Access key** are listed there
3. The **password** is the one you chose when you first set up the Nefit Easy app

## HomeKit Capabilities

The plugin exposes a single **Thermostat** service:

| Characteristic              | Access     | Notes                                      |
|-----------------------------|------------|--------------------------------------------|
| Current Temperature         | Read       | Live indoor temperature from thermostat    |
| Target Temperature          | Read/Write | Range 5–30 °C, step 0.5 °C                |
| Current Heating/Cooling State | Read     | Off or Heat, based on burner activity      |
| Target Heating/Cooling State  | Read/Write | Off (sets temp to 5 °C) or Heat           |
| Temperature Display Units   | Read       | Always Celsius                             |

## Known Limitations

- **Cooling / Auto modes are not supported.** The Nefit Easy is a heating-only device; only Off and Heat states are exposed.
- **Turning Off via HomeKit** sets the target temperature to the minimum (5 °C) rather than truly disabling the thermostat, because the Nefit Easy does not support a hard off command over the XMPP API.
- **Schedules are not exposed.** The thermostat's built-in weekly programs remain active on the device itself; this plugin only controls the manual setpoint.
- **Multiple heating circuits** are not supported. The plugin always targets `hc1`.
- Nefit Easy credentials are stored in plain text in `config.json`. Keep your Homebridge host secure.

## Migrating from homebridge-nefit-easy

1. Remove the old plugin: `npm uninstall -g homebridge-nefit-easy`
2. Install this plugin: `npm install -g homebridge-bosch-nefit-easy`
3. Change `"accessory": "NefitEasy"` → `"accessory": "BoschNefitEasy"` in your config
4. Restart Homebridge

Your credentials (serial number, access key, password) are the same.

## License

MIT
