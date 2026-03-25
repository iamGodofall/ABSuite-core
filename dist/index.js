"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suiteList = exports.suiteStart = void 0;
// Barrel exports for ABSuite core
const suiteStart = () => console.log('🚀 ABSuite started');
exports.suiteStart = suiteStart;
const suiteList = () => console.log('Available suites listed');
exports.suiteList = suiteList;
