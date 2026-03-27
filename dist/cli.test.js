"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
describe('ABSuite CLI', () => {
    const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockImplementation(() => Buffer.from(''));
    test('lists suites', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        (0, index_1.suiteList)();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
    test('starts suite', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        (0, index_1.suiteStart)();
        expect(consoleSpy).toHaveBeenCalledWith('🚀 ABSuite Suite Orchestration Starting...');
        consoleSpy.mockRestore();
    });
    afterAll(() => {
        execSyncSpy.mockRestore();
    });
});
