import type {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from 'homebridge';

// bosch-xmpp exports named factory functions, not a createClient helper.
// Each factory returns a class instance when called as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NefitEasyClient } = require('bosch-xmpp');

interface NefitConfig extends AccessoryConfig {
  serialNumber: string;
  accessKey: string;
  password: string;
  pollingInterval?: number;
  debug?: boolean;
}

interface UiStatusValue {
  IHT: string;   // in-house temperature
  TSP: string;   // temperature setpoint
  BAI: string;   // burner active indicator ("No" | "CH" | ...)
  [key: string]: unknown;
}

interface UiStatus {
  id: string;
  type: string;
  value: UiStatusValue;
}

const MIN_TEMP = 5;
const MAX_TEMP = 30;
const TEMP_STEP = 0.5;
const RECONNECT_DELAY_MS = 30_000;

export class NefitEasyAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly config: NefitConfig;
  private readonly api: API;
  private readonly debugEnabled: boolean;

  private readonly thermostatService: Service;
  private readonly informationService: Service;

  private client: ReturnType<typeof NefitEasyClient> | null = null;
  private connected = false;
  private reconnecting = false;

  private currentTemperature = 20;
  private targetTemperature = 20;
  private currentHeatingState = 0;
  private targetHeatingState = 1;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.config = config as NefitConfig;
    this.api = api;
    this.debugEnabled = this.config.debug === true;

    this.dbg('Debug logging enabled');
    this.dbg(`Config: serialNumber=${this.config.serialNumber}, pollingInterval=${this.config.pollingInterval ?? 60}s`);

    const { Service, Characteristic } = this.api.hap;

    this.log.info('Initializing NefitEasy2 accessory...');

    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Bosch / Nefit')
      .setCharacteristic(Characteristic.Model, 'Nefit Easy')
      .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber ?? 'Unknown');

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
      .onGet(() => this.api.hap.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => { /* read-only — ignore write */ });

    this.connect();
  }

  getServices(): Service[] {
    return [this.informationService, this.thermostatService];
  }

  private dbg(msg: string): void {
    if (this.debugEnabled) {
      this.log.info(`[DEBUG] ${msg}`);
    }
  }

  private createClient() {
    this.dbg('Creating NefitEasyClient instance via factory function');
    // NefitEasyClient is exported as a factory: require('bosch-xmpp').NefitEasyClient(opts)
    return NefitEasyClient({
      serialNumber: this.config.serialNumber,
      accessKey: this.config.accessKey,
      password: this.config.password,
    });
  }

  private async connect(): Promise<void> {
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
      this.dbg('Connection successful, starting initial poll…');
      await this.poll();
      this.startPolling();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.log.error(`Connection failed: ${msg}. Retrying in 30 s…`);
      this.dbg(`Full error: ${(err as Error).stack ?? msg}`);
      this.connected = false;
      this.client = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) {
      this.dbg('scheduleReconnect() called but already scheduled — skipping');
      return;
    }
    this.reconnecting = true;
    this.stopPolling();
    this.dbg(`Scheduling reconnect in ${RECONNECT_DELAY_MS / 1000} s…`);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private startPolling(): void {
    this.stopPolling();
    const interval = (this.config.pollingInterval ?? 60) * 1000;
    this.dbg(`Starting poll timer every ${interval / 1000} s`);
    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      this.dbg('Stopping poll timer');
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.connected || !this.client) {
      this.dbg('poll() skipped — not connected');
      return;
    }

    try {
      this.dbg('Polling /ecus/rrc/uiStatus…');
      const status: UiStatus = await this.client.get('/ecus/rrc/uiStatus');
      this.dbg(`Raw uiStatus response: ${JSON.stringify(status)}`);
      this.applyStatus(status);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.log.warn(`Poll failed: ${msg}. Will retry next interval.`);
      this.dbg(`Poll error stack: ${(err as Error).stack ?? msg}`);
      this.connected = false;
      this.client = null;
      this.scheduleReconnect();
    }
  }

  private applyStatus(status: UiStatus): void {
    const { Characteristic } = this.api.hap;

    const v = status.value;
    const inHouseTemp = Number(v.IHT);
    const setpoint = Number(v.TSP);
    const burnerActive = v.BAI !== 'No' && v.BAI !== '' && v.BAI !== undefined;

    this.dbg(`Parsed — IHT: ${v.IHT} => ${inHouseTemp}, TSP: ${v.TSP} => ${setpoint}, BAI: ${v.BAI} => burnerActive: ${burnerActive}`);

    if (!Number.isNaN(inHouseTemp)) {
      this.currentTemperature = inHouseTemp;
      this.thermostatService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
    } else {
      this.log.warn(`Unexpected IHT (in-house-temp) value: ${v.IHT}`);
    }

    if (!Number.isNaN(setpoint)) {
      this.targetTemperature = setpoint;
      this.thermostatService
        .getCharacteristic(Characteristic.TargetTemperature)
        .updateValue(this.targetTemperature);
    } else {
      this.log.warn(`Unexpected TSP (temp-setpoint) value: ${v.TSP}`);
    }

    const newHeatingState = burnerActive
      ? Characteristic.CurrentHeatingCoolingState.HEAT
      : Characteristic.CurrentHeatingCoolingState.OFF;

    if (newHeatingState !== this.currentHeatingState) {
      this.dbg(`Heating state changed: ${this.currentHeatingState} → ${newHeatingState}`);
      this.currentHeatingState = newHeatingState;
      this.thermostatService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .updateValue(this.currentHeatingState);
    }

    this.log.info(`Status — current: ${inHouseTemp}°C, setpoint: ${setpoint}°C, burner: ${burnerActive} (BAI=${v.BAI})`);
  }

  private async handleSetTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temp = value as number;
    this.log.info(`Setting target temperature to ${temp}°C`);
    this.dbg(`PUT /heatingCircuits/hc1/temperatureRoomManual { value: ${temp} }`);

    if (!this.connected || !this.client) {
      this.log.error('Cannot set temperature — not connected.');
      throw new this.api.hap.HapStatusError(
        this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }

    try {
      await this.client.put('/heatingCircuits/hc1/temperatureRoomManual', { value: temp });
      this.targetTemperature = temp;
      this.log.info(`Target temperature set to ${temp}°C`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.log.error(`Failed to set temperature: ${msg}`);
      this.dbg(`Set temperature error stack: ${(err as Error).stack ?? msg}`);
      throw new this.api.hap.HapStatusError(
        this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async handleSetTargetHeatingState(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const state = value as number;
    this.dbg(`SET TargetHeatingCoolingState => ${state}`);

    if (state === Characteristic.TargetHeatingCoolingState.OFF) {
      this.log.info('Heating set to OFF — setting temperature to minimum (5°C)');
      await this.handleSetTargetTemperature(MIN_TEMP);
      this.targetHeatingState = Characteristic.TargetHeatingCoolingState.OFF;
    } else {
      this.log.info('Heating set to HEAT');
      this.targetHeatingState = Characteristic.TargetHeatingCoolingState.HEAT;
    }

    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(this.targetHeatingState);
  }
}
