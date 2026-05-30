"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NefitEasyAccessory = void 0;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BoschXMPP = require('bosch-xmpp');
const MIN_TEMP = 5;
const MAX_TEMP = 30;
const TEMP_STEP = 0.5;
const RECONNECT_DELAY_MS = 30_000;
class NefitEasyAccessory {
    log;
    config;
    api;
    thermostatService;
    informationService;
    client = null;
    connected = false;
    reconnecting = false;
    currentTemperature = 20;
    targetTemperature = 20;
    currentHeatingState = 0;
    targetHeatingState = 1;
    pollTimer = null;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        const { Service, Characteristic } = this.api.hap;
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Bosch / Nefit')
            .setCharacteristic(Characteristic.Model, 'Nefit Easy')
            .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber ?? 'Unknown');
        this.thermostatService = new Service.Thermostat(this.config.name);
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(() => this.currentTemperature);
        this.thermostatService
            .getCharacteristic(Characteristic.TargetTemperature)
            .setProps({ minValue: MIN_TEMP, maxValue: MAX_TEMP, minStep: TEMP_STEP })
            .onGet(() => this.targetTemperature)
            .onSet((value) => this.handleSetTargetTemperature(value));
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .onGet(() => this.currentHeatingState);
        this.thermostatService
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(() => this.targetHeatingState)
            .onSet((value) => this.handleSetTargetHeatingState(value));
        this.thermostatService
            .getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(() => this.api.hap.Characteristic.TemperatureDisplayUnits.CELSIUS)
            .onSet(() => { });
        this.connect();
    }
    getServices() {
        return [this.informationService, this.thermostatService];
    }
    createClient() {
        return BoschXMPP.createClient({
            serialNumber: this.config.serialNumber,
            accessKey: this.config.accessKey,
            password: this.config.password,
        });
    }
    async connect() {
        if (this.reconnecting) {
            return;
        }
        try {
            this.log.info('Connecting to Nefit Easy backend…');
            this.client = this.createClient();
            await this.client.connect();
            this.connected = true;
            this.reconnecting = false;
            this.log.info('Connected to Nefit Easy backend.');
            await this.poll();
            this.startPolling();
        }
        catch (err) {
            this.log.error(`Connection failed: ${err.message}. Retrying in 30 s…`);
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
        setTimeout(() => {
            this.reconnecting = false;
            this.connect();
        }, RECONNECT_DELAY_MS);
    }
    startPolling() {
        this.stopPolling();
        const interval = (this.config.pollingInterval ?? 60) * 1000;
        this.pollTimer = setInterval(() => this.poll(), interval);
    }
    stopPolling() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async poll() {
        if (!this.connected || !this.client) {
            return;
        }
        try {
            const status = await this.client.get('/ecus/rrc/uiStatus');
            this.applyStatus(status);
        }
        catch (err) {
            this.log.warn(`Poll failed: ${err.message}. Will retry next interval.`);
            // Connection may be stale — reconnect
            this.connected = false;
            this.client = null;
            this.scheduleReconnect();
        }
    }
    applyStatus(status) {
        const { Characteristic } = this.api.hap;
        const inHouseTemp = Number(status['in-house-temp']);
        const setpoint = Number(status['temp-setpoint']);
        const burnerActive = status['boiler-indicator'] === 'CH';
        if (!Number.isNaN(inHouseTemp)) {
            this.currentTemperature = inHouseTemp;
            this.thermostatService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .updateValue(this.currentTemperature);
        }
        if (!Number.isNaN(setpoint)) {
            this.targetTemperature = setpoint;
            this.thermostatService
                .getCharacteristic(Characteristic.TargetTemperature)
                .updateValue(this.targetTemperature);
        }
        const newHeatingState = burnerActive
            ? Characteristic.CurrentHeatingCoolingState.HEAT
            : Characteristic.CurrentHeatingCoolingState.OFF;
        if (newHeatingState !== this.currentHeatingState) {
            this.currentHeatingState = newHeatingState;
            this.thermostatService
                .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
                .updateValue(this.currentHeatingState);
        }
        this.log.debug(`Status — current: ${inHouseTemp}°C, setpoint: ${setpoint}°C, burner: ${burnerActive}`);
    }
    async handleSetTargetTemperature(value) {
        const temp = value;
        this.log.info(`Setting target temperature to ${temp}°C`);
        if (!this.connected || !this.client) {
            this.log.error('Cannot set temperature — not connected.');
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
        if (state === Characteristic.TargetHeatingCoolingState.OFF) {
            this.log.info('Heating set to OFF — setting temperature to minimum (5°C)');
            await this.handleSetTargetTemperature(MIN_TEMP);
            this.targetHeatingState = Characteristic.TargetHeatingCoolingState.OFF;
        }
        else {
            this.log.info('Heating set to HEAT');
            this.targetHeatingState = Characteristic.TargetHeatingCoolingState.HEAT;
        }
        this.thermostatService
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .updateValue(this.targetHeatingState);
    }
}
exports.NefitEasyAccessory = NefitEasyAccessory;
