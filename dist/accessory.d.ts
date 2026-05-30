import type { AccessoryConfig, AccessoryPlugin, API, Logging, Service } from 'homebridge';
export declare class NefitEasyAccessory implements AccessoryPlugin {
    private readonly log;
    private readonly config;
    private readonly api;
    private readonly thermostatService;
    private readonly informationService;
    private client;
    private connected;
    private reconnecting;
    private currentTemperature;
    private targetTemperature;
    private currentHeatingState;
    private targetHeatingState;
    private pollTimer;
    constructor(log: Logging, config: AccessoryConfig, api: API);
    getServices(): Service[];
    private createClient;
    private connect;
    private scheduleReconnect;
    private startPolling;
    private stopPolling;
    private poll;
    private applyStatus;
    private handleSetTargetTemperature;
    private handleSetTargetHeatingState;
}
