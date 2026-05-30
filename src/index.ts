import type { API } from 'homebridge';
import { NefitEasyAccessory } from './accessory';

export default (api: API): void => {
  api.registerAccessory('NefitEasy2', NefitEasyAccessory);
};
