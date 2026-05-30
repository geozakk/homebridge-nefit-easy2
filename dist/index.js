"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const accessory_1 = require("./accessory");
exports.default = (api) => {
    api.registerAccessory('BoschNefitEasy', accessory_1.NefitEasyAccessory);
};
