import { suiteList, suiteStart } from './index';

describe('ABSuite CLI', () => {
  const execSyncSpy = jest.spyOn(require('child_process'), 'execSync').mockImplementation(() => Buffer.from(''));

  test('lists suites', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    suiteList();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('starts suite', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    suiteStart();
    expect(consoleSpy).toHaveBeenCalledWith('🚀 ABSuite Suite Orchestration Starting...');
    consoleSpy.mockRestore();
  });

  afterAll(() => {
    execSyncSpy.mockRestore();
  });
});
