"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
describe('ABSuite CLI', () => {
    test('lists suites', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        (0, index_1.suiteList)();
        expect(consoleSpy).toHaveBeenCalledWith('Available suites listed');
        consoleSpy.mockRestore();
    });
    test('starts suite', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        (0, index_1.suiteStart)();
        expect(consoleSpy).toHaveBeenCalledWith('🚀 ABSuite started');
        consoleSpy.mockRestore();
    });
});
