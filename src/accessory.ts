import type {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from 'homebridge';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BoschXMPP = require('bosch-xmpp');

interface NefitConfig extends AccessoryConfig {
  serialNumber: string;
  accessKey: string;
  password: string;
  pollingInterval?: number;
}

interface UiStatus {
  'in-house-temp': number;
  'temp-setpoint': number;
  'boiler-indicator': string;
}

const MIN_TEMP = 5;
const MAX_TEMP = 30;
const TEMP_STEP = 0.5;
const RECONNECT_DELAY_MS = 30_000;

export class NefitEasyAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly config: NefitConfig;
  private readonly api: API;

  private readonly thermostatService: Service;
  private readonly informationService: Service;

  private client: ReturnType<typeof BoschXMPP.createClient> | null = null;
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
      .onSet(() => { /* read-only — ignore write */ });

    this.connect();
  }

  getServices(): Service[] {
    return [this.informationService, this.thermostatService];
  }

  private createClient() {
    return BoschXMPP.createClient({
      serialNumber: this.config.serialNumber,
      accessKey: this.config.accessKey,
      password: this.config.password,
    });
  }

  private async connect(): Promise<void> {
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
    } catch (err) {
      this.log.error(`Connection failed: ${(err as Error).message}. Retrying in 30 s…`);
      this.connected = false;
      this.client = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
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

  private startPolling(): void {
    this.stopPolling();
    const interval = (this.config.pollingInterval ?? 60) * 1000;
    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      const status: UiStatus = await this.client.get('/ecus/rrc/uiStatus');
      this.applyStatus(status);
    } catch (err) {
      this.log.warn(`Poll failed: ${(err as Error).message}. Will retry next interval.`);
      // Connection may be stale — reconnect
      this.connected = false;
      this.client = null;
      this.scheduleReconnect();
    }
  }

  private applyStatus(status: UiStatus): void {
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

    this.log.debug(
      `Status — current: ${inHouseTemp}°C, setpoint: ${setpoint}°C, burner: ${burnerActive}`,
    );
  }

  private async handleSetTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temp = value as number;
    this.log.info(`Setting target temperature to ${temp}°C`);

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
      this.log.error(`Failed to set temperature: ${(err as Error).message}`);
      throw new this.api.hap.HapStatusError(
        this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async handleSetTargetHeatingState(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const state = value as number;

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
