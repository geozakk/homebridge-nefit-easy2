"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const accessory_1 = require("./accessory");
exports.default = (api) => {
    api.registerAccessory('NefitEasy2', accessory_1.NefitEasyAccessory);
};
