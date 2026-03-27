import { suiteList, suiteStart } from './index';

describe('ABSuite CLI', () => {
  test('lists suites', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    suiteList();
    expect(consoleSpy).toHaveBeenCalledWith('Available suites listed');
    consoleSpy.mockRestore();
  });

  test('starts suite', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    suiteStart();
    expect(consoleSpy).toHaveBeenCalledWith('🚀 ABSuite started');
    consoleSpy.mockRestore();
  });
});
