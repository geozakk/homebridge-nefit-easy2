"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NefitEasyAccessory = void 0;
// bosch-xmpp exports named factory functions, not a createClient helper.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NefitEasyClient } = require('bosch-xmpp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLUGIN_VERSION = require('../package.json').version;
// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_TEMP = 5;
const MAX_TEMP = 30;
const TEMP_STEP = 0.5;
const RECONNECT_DELAY = 30_000;
// ─── Accessory ────────────────────────────────────────────────────────────────
class NefitEasyAccessory {
    log;
    config;
    api;
    feat;
    debugEnabled;
    // Core service (always present)
    informationService;
    thermostatService;
    // Optional services
    hotWaterService;
    manualModeService;
    holidayModeService;
    awayModeService;
    outdoorTempService;
    hotWaterTempService;
    // Connection state
    client = null;
    connected = false;
    reconnecting = false;
    pollTimer = null;
    // Cached values
    currentTemperature = 20;
    targetTemperature = 20;
    currentHeatingState = 0;
    targetHeatingState = 1;
    hotWaterActive = false;
    manualModeActive = false;
    holidayModeActive = false;
    awayModeActive = false;
    outdoorTemperature = 0;
    hotWaterTemperature = 0;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.feat = this.config.features ?? {};
        this.debugEnabled = this.config.debug === true;
        this.dbg('Debug logging enabled');
        const { Service, Characteristic } = this.api.hap;
        this.log.info('Initializing BoschNefitEasy accessory...');
        // ── Accessory Information ─────────────────────────────────────────────────
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Bosch')
            .setCharacteristic(Characteristic.Model, 'Nefit Easy')
            .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber ?? 'Unknown')
            .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);
        // ── Thermostat (always on) ────────────────────────────────────────────────
        this.thermostatService = new Service.Thermostat(this.config.name);
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(() => {
            this.dbg(`GET CurrentTemperature => ${this.currentTemperature}`);
            return this.currentTemperature;
        });
        this.thermostatService
            .getCharacteristic(Characteristic.TargetTemperature)
            .setProps({ minValue: MIN_TEMP, maxValue: MAX_TEMP, minStep: TEMP_STEP })
            .onGet(() => {
            this.dbg(`GET TargetTemperature => ${this.targetTemperature}`);
            return this.targetTemperature;
        })
            .onSet((value) => this.handleSetTargetTemperature(value));
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .onGet(() => {
            this.dbg(`GET CurrentHeatingCoolingState => ${this.currentHeatingState}`);
            return this.currentHeatingState;
        });
        this.thermostatService
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(() => {
            this.dbg(`GET TargetHeatingCoolingState => ${this.targetHeatingState}`);
            return this.targetHeatingState;
        })
            .onSet((value) => this.handleSetTargetHeatingState(value));
        this.thermostatService
            .getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS)
            .onSet(() => { });
        // ── Hot Water Switch ──────────────────────────────────────────────────────
        if (this.feat.hotWater) {
            this.hotWaterService = new Service.Switch('Hot Water', 'hot-water');
            this.hotWaterService
                .getCharacteristic(Characteristic.On)
                .onGet(() => {
                this.dbg(`GET HotWater => ${this.hotWaterActive}`);
                return this.hotWaterActive;
            })
                .onSet((value) => this.handleSetHotWater(value));
            this.log.info('Feature enabled: Hot Water switch');
        }
        // ── Manual Mode Switch ────────────────────────────────────────────────────
        if (this.feat.manualMode) {
            this.manualModeService = new Service.Switch('Manual Mode', 'manual-mode');
            this.manualModeService
                .getCharacteristic(Characteristic.On)
                .onGet(() => {
                this.dbg(`GET ManualMode => ${this.manualModeActive}`);
                return this.manualModeActive;
            })
                .onSet((value) => this.handleSetManualMode(value));
            this.log.info('Feature enabled: Manual Mode switch');
        }
        // ── Holiday Mode Switch (read-only) ───────────────────────────────────────
        if (this.feat.holidayMode) {
            this.holidayModeService = new Service.Switch('Holiday Mode', 'holiday-mode');
            this.holidayModeService
                .getCharacteristic(Characteristic.On)
                .onGet(() => {
                this.dbg(`GET HolidayMode => ${this.holidayModeActive}`);
                return this.holidayModeActive;
            })
                .onSet((_value) => {
                this.log.warn('Holiday Mode cannot be toggled from HomeKit — set it on the thermostat directly.');
                // Restore the current value so the switch snaps back
                setTimeout(() => {
                    this.holidayModeService
                        .getCharacteristic(Characteristic.On)
                        .updateValue(this.holidayModeActive);
                }, 500);
            });
            this.log.info('Feature enabled: Holiday Mode indicator (read-only)');
        }
        // ── Away Mode Occupancy Sensor (read-only) ────────────────────────────────
        if (this.feat.awayMode) {
            this.awayModeService = new Service.OccupancySensor('Home / Away', 'away-mode');
            this.awayModeService
                .getCharacteristic(Characteristic.OccupancyDetected)
                .onGet(() => {
                // OccupancyDetected=1 means home, 0 means away
                const occupied = !this.awayModeActive;
                this.dbg(`GET OccupancyDetected => ${occupied} (awayMode=${this.awayModeActive})`);
                return occupied
                    ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
                    : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
            });
            this.log.info('Feature enabled: Away Mode occupancy sensor');
        }
        // ── Outdoor Temperature Sensor ────────────────────────────────────────────
        if (this.feat.outdoorTemperature) {
            this.outdoorTempService = new Service.TemperatureSensor('Outdoor Temperature', 'outdoor-temp');
            this.outdoorTempService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({ minValue: -40, maxValue: 60 })
                .onGet(() => {
                this.dbg(`GET OutdoorTemperature => ${this.outdoorTemperature}`);
                return this.outdoorTemperature;
            });
            this.log.info('Feature enabled: Outdoor Temperature sensor');
        }
        // ── Hot Water Temperature Sensor ──────────────────────────────────────────
        if (this.feat.hotWaterTemperature) {
            this.hotWaterTempService = new Service.TemperatureSensor('Hot Water Temperature', 'hw-temp');
            this.hotWaterTempService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({ minValue: 0, maxValue: 100 })
                .onGet(() => {
                this.dbg(`GET HotWaterTemperature => ${this.hotWaterTemperature}`);
                return this.hotWaterTemperature;
            });
            this.log.info('Feature enabled: Hot Water Temperature sensor');
        }
        this.connect();
    }
    getServices() {
        const services = [this.informationService, this.thermostatService];
        if (this.hotWaterService) {
            services.push(this.hotWaterService);
        }
        if (this.manualModeService) {
            services.push(this.manualModeService);
        }
        if (this.holidayModeService) {
            services.push(this.holidayModeService);
        }
        if (this.awayModeService) {
            services.push(this.awayModeService);
        }
        if (this.outdoorTempService) {
            services.push(this.outdoorTempService);
        }
        if (this.hotWaterTempService) {
            services.push(this.hotWaterTempService);
        }
        return services;
    }
    // ─── Connection ─────────────────────────────────────────────────────────────
    createClient() {
        this.dbg('Creating NefitEasyClient instance via factory function');
        return NefitEasyClient({
            serialNumber: this.config.serialNumber,
            accessKey: this.config.accessKey,
            password: this.config.password,
        });
    }
    async connect() {
        if (this.reconnecting) {
            this.dbg('connect() called while already reconnecting — skipping');
            return;
        }
        try {
            this.log.info('Connecting to Nefit Easy backend…');
            this.dbg(`XMPP host: wa2-mz36-qrmzh6.bosch.de:5222, serial: ${this.config.serialNumber}`);
            this.client = this.createClient();
            this.dbg('Client created, calling client.connect()…');
            await this.client.connect();
            this.connected = true;
            this.reconnecting = false;
            this.log.info('Connected to Nefit Easy backend.');
            await this.poll();
            this.startPolling();
        }
        catch (err) {
            const msg = err.message ?? String(err);
            this.log.error(`Connection failed: ${msg}. Retrying in 30 s…`);
            this.dbg(`Full error: ${err.stack ?? msg}`);
            this.connected = false;
            this.client = null;
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (this.reconnecting) {
            return;
        }
        this.reconnecting = true;
        this.stopPolling();
        this.dbg(`Scheduling reconnect in ${RECONNECT_DELAY / 1000} s…`);
        setTimeout(() => {
            this.reconnecting = false;
            this.connect();
        }, RECONNECT_DELAY);
    }
    startPolling() {
        this.stopPolling();
        const interval = (this.config.pollingInterval ?? 60) * 1000;
        this.dbg(`Starting poll timer every ${interval / 1000} s`);
        this.pollTimer = setInterval(() => this.poll(), interval);
    }
    stopPolling() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    // ─── Polling ─────────────────────────────────────────────────────────────────
    async poll() {
        if (!this.connected || !this.client) {
            this.dbg('poll() skipped — not connected');
            return;
        }
        try {
            this.dbg('Polling /ecus/rrc/uiStatus…');
            const status = await this.client.get('/ecus/rrc/uiStatus');
            this.dbg(`Raw uiStatus: ${JSON.stringify(status)}`);
            this.applyUiStatus(status);
            if (this.feat.outdoorTemperature) {
                await this.pollOutdoorTemperature();
            }
            if (this.feat.hotWaterTemperature) {
                await this.pollHotWaterTemperature();
            }
        }
        catch (err) {
            const msg = err.message ?? String(err);
            this.log.warn(`Poll failed: ${msg}. Will retry after reconnect.`);
            this.dbg(`Poll error: ${err.stack ?? msg}`);
            this.connected = false;
            this.client = null;
            this.scheduleReconnect();
        }
    }
    async pollOutdoorTemperature() {
        try {
            this.dbg('Polling /system/sensors/temperatures/outdoor_t1…');
            const res = await this.client.get('/system/sensors/temperatures/outdoor_t1');
            const temp = Number(res.value);
            if (!Number.isNaN(temp)) {
                this.outdoorTemperature = temp;
                this.outdoorTempService
                    .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
                    .updateValue(temp);
                this.dbg(`Outdoor temperature: ${temp}°C`);
            }
        }
        catch (err) {
            this.log.warn(`Outdoor temperature poll failed: ${err.message}`);
        }
    }
    async pollHotWaterTemperature() {
        try {
            this.dbg('Polling /dhwCircuits/dhw1/actualTemp…');
            const res = await this.client.get('/dhwCircuits/dhw1/actualTemp');
            const temp = Number(res.value);
            if (!Number.isNaN(temp)) {
                this.hotWaterTemperature = temp;
                this.hotWaterTempService
                    .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
                    .updateValue(temp);
                this.dbg(`Hot water temperature: ${temp}°C`);
            }
        }
        catch (err) {
            this.log.warn(`Hot water temperature poll failed: ${err.message}`);
        }
    }
    // ─── Status application ───────────────────────────────────────────────────────
    applyUiStatus(status) {
        const { Characteristic } = this.api.hap;
        const v = status.value;
        // ── Core temperatures ────────────────────────────────────────────────────
        const inHouseTemp = Number(v.IHT);
        const setpoint = Number(v.TSP);
        const burnerOn = v.BAI !== 'No' && v.BAI !== '' && v.BAI !== undefined;
        this.dbg(`Parsed — IHT:${inHouseTemp} TSP:${setpoint} BAI:${v.BAI} DHW:${v.DHW} UMD:${v.UMD} HMD:${v.HMD} DAS:${v.DAS}`);
        if (!Number.isNaN(inHouseTemp)) {
            this.currentTemperature = inHouseTemp;
            this.thermostatService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .updateValue(inHouseTemp);
        }
        else {
            this.log.warn(`Unexpected IHT value: ${v.IHT}`);
        }
        if (!Number.isNaN(setpoint)) {
            this.targetTemperature = setpoint;
            this.thermostatService
                .getCharacteristic(Characteristic.TargetTemperature)
                .updateValue(setpoint);
        }
        else {
            this.log.warn(`Unexpected TSP value: ${v.TSP}`);
        }
        // CurrentHeatingCoolingState — reflects actual burner activity
        const newCurrentState = burnerOn
            ? Characteristic.CurrentHeatingCoolingState.HEAT
            : Characteristic.CurrentHeatingCoolingState.OFF;
        if (newCurrentState !== this.currentHeatingState) {
            this.currentHeatingState = newCurrentState;
            this.thermostatService
                .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
                .updateValue(newCurrentState);
        }
        // TargetHeatingCoolingState — Off when room >= setpoint, Heat when room needs warming
        const newTargetState = (!Number.isNaN(inHouseTemp) && !Number.isNaN(setpoint) && inHouseTemp < setpoint)
            ? Characteristic.TargetHeatingCoolingState.HEAT
            : Characteristic.TargetHeatingCoolingState.OFF;
        if (newTargetState !== this.targetHeatingState) {
            this.targetHeatingState = newTargetState;
            this.thermostatService
                .getCharacteristic(Characteristic.TargetHeatingCoolingState)
                .updateValue(newTargetState);
        }
        this.log.info(`Status — current: ${inHouseTemp}°C, setpoint: ${setpoint}°C, burner: ${burnerOn}, mode: ${newTargetState === 1 ? 'Heat' : 'Off'}`);
        // ── Hot Water ─────────────────────────────────────────────────────────────
        if (this.feat.hotWater && this.hotWaterService) {
            const hwOn = v.DHW === 'on';
            if (hwOn !== this.hotWaterActive) {
                this.hotWaterActive = hwOn;
                this.hotWaterService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(hwOn);
                this.dbg(`Hot water state updated: ${hwOn}`);
            }
        }
        // ── Manual Mode ───────────────────────────────────────────────────────────
        if (this.feat.manualMode && this.manualModeService) {
            const manual = v.UMD === 'manual';
            if (manual !== this.manualModeActive) {
                this.manualModeActive = manual;
                this.manualModeService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(manual);
                this.dbg(`Manual mode updated: ${manual}`);
            }
        }
        // ── Holiday Mode ──────────────────────────────────────────────────────────
        if (this.feat.holidayMode && this.holidayModeService) {
            const holiday = v.HMD === 'on';
            if (holiday !== this.holidayModeActive) {
                this.holidayModeActive = holiday;
                this.holidayModeService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(holiday);
                this.dbg(`Holiday mode updated: ${holiday}`);
            }
        }
        // ── Away Mode ─────────────────────────────────────────────────────────────
        if (this.feat.awayMode && this.awayModeService) {
            const away = v.DAS === 'on';
            if (away !== this.awayModeActive) {
                this.awayModeActive = away;
                const occupied = away
                    ? Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
                    : Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
                this.awayModeService
                    .getCharacteristic(Characteristic.OccupancyDetected)
                    .updateValue(occupied);
                this.dbg(`Away mode updated: ${away} => occupancy: ${occupied}`);
            }
        }
    }
    // ─── Handlers ────────────────────────────────────────────────────────────────
    async handleSetTargetTemperature(value) {
        const temp = value;
        this.log.info(`Setting target temperature to ${temp}°C`);
        this.dbg(`PUT /heatingCircuits/hc1/temperatureRoomManual { value: ${temp} }`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        try {
            await this.client.put('/heatingCircuits/hc1/temperatureRoomManual', { value: temp });
            this.targetTemperature = temp;
            this.log.info(`Target temperature set to ${temp}°C`);
        }
        catch (err) {
            this.log.error(`Failed to set temperature: ${err.message}`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async handleSetTargetHeatingState(value) {
        const { Characteristic } = this.api.hap;
        const state = value;
        this.dbg(`SET TargetHeatingCoolingState => ${state}`);
        if (state === Characteristic.TargetHeatingCoolingState.OFF) {
            this.log.info('Heating set to OFF — setting temperature to minimum (5°C)');
            await this.handleSetTargetTemperature(MIN_TEMP);
        }
        else {
            this.log.info('Heating set to HEAT');
        }
        this.targetHeatingState = state;
        this.thermostatService
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .updateValue(this.targetHeatingState);
    }
    async handleSetHotWater(value) {
        const on = value;
        this.log.info(`Setting hot water: ${on ? 'on' : 'off'}`);
        this.dbg(`PUT /dhwCircuits/dhw1/operationMode { value: "${on ? 'on' : 'off'}" }`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        try {
            await this.client.put('/dhwCircuits/dhw1/operationMode', { value: on ? 'on' : 'off' });
            this.hotWaterActive = on;
            this.log.info(`Hot water set to ${on ? 'on' : 'off'}`);
        }
        catch (err) {
            this.log.error(`Failed to set hot water: ${err.message}`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async handleSetManualMode(value) {
        const manual = value;
        const mode = manual ? 'manual' : 'clock';
        this.log.info(`Setting heating mode to: ${mode}`);
        this.dbg(`PUT /heatingCircuits/hc1/operationMode { value: "${mode}" }`);
        if (!this.connected || !this.client) {
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        try {
            await this.client.put('/heatingCircuits/hc1/operationMode', { value: mode });
            this.manualModeActive = manual;
            this.log.info(`Heating mode set to ${mode}`);
        }
        catch (err) {
            this.log.error(`Failed to set heating mode: ${err.message}`);
            throw new this.api.hap.HapStatusError(-70402 /* this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────────────
    dbg(msg) {
        if (this.debugEnabled) {
            this.log.info(`[DEBUG] ${msg}`);
        }
    }
}
exports.NefitEasyAccessory = NefitEasyAccessory;
