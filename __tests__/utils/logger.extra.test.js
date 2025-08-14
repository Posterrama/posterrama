// Consolidated comprehensive logger extra coverage (migrated from root-level logger-extra.test.js)
const fs = require('fs');
const path = require('path');

// Helper to isolate a fresh logger instance after manipulating config/logs
function loadFreshLogger(manipulateConfig) {
  const configPath = path.join(__dirname, '..', '..', 'config.json');
  const original = fs.readFileSync(configPath, 'utf8');
  if (manipulateConfig) {
    const modified = manipulateConfig(JSON.parse(original));
    fs.writeFileSync(configPath, JSON.stringify(modified, null, 2));
  }
  jest.isolateModules(() => { delete require.cache[require.resolve('../../logger')]; });
  const logger = require('../../logger');
  fs.writeFileSync(configPath, original);
  return logger;
}

describe('Logger extra coverage (consolidated)', () => {
  test('creates logs directory if missing (re-require)', () => {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    if (fs.existsSync(logsDir)) {
      fs.rmSync(logsDir, { recursive: true, force: true });
    }
    const logger = loadFreshLogger();
    logger.info('Dir creation test');
    expect(fs.existsSync(logsDir)).toBe(true);
  });

  test('serializes object messages and hides _raw field (direct log object)', () => {
    const logger = require('../../logger');
    logger.memoryLogs = [];
    logger.log({ level: 'info', message: { event: 'test', _raw: 'secret_data', nested: { a: 1 } } });
    const last = logger.getRecentLogs().slice(-1)[0];
    expect(last).toBeDefined();
    expect(last.message).not.toContain('secret_data');
    expect(last.message).toContain('"event"');
  });

  test('handles unserializable (circular) object', () => {
    const logger = require('../../logger');
    logger.memoryLogs = [];
    const a = { name: 'circular' }; a.self = a;
    logger.log({ level: 'info', message: a });
    const last = logger.getRecentLogs().slice(-1)[0];
    expect(last).toBeDefined();
    expect(last.message).toBe('[Unserializable Object]');
  });

  test('excludes admin panel excluded messages', () => {
    const logger = require('../../logger');
    logger.memoryLogs = [];
    logger.info('[Request Logger] Received: something');
    logger.info('A normal message');
    const logs = logger.getRecentLogs();
    expect(logs.find(l => l.message.includes('Received'))).toBeUndefined();
    expect(logs.find(l => l.message.includes('normal'))).toBeDefined();
  });

  test('getRecentLogs level threshold filtering and limit', () => {
    const logger = require('../../logger');
    logger.memoryLogs = [];
    logger.info('info one');
    logger.warn('warn one');
    logger.error('error one');
    const warnAndError = logger.getRecentLogs('warn');
    expect(warnAndError.map(l => l.level)).toEqual(['WARN', 'ERROR']);
    const limited = logger.getRecentLogs(null, 2);
    expect(limited.length).toBe(2);
  });

  test('fatal maps to error level', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = loadFreshLogger(cfg => ({ ...cfg, clockTimezone: 'UTC' }));
    logger.memoryLogs = [];
    logger.fatal('fatal message');
    const logs = logger.getRecentLogs();
    const fatal = logs.find(l => l.message === 'fatal message');
    expect(fatal).toBeDefined();
    expect(fatal.level).toBe('ERROR');
  });

  test('timestamp fallback on invalid timezone config', () => {
    const logger = loadFreshLogger(cfg => ({ ...cfg, clockTimezone: 'Invalid/Timezone' }));
    logger.memoryLogs = [];
    logger.info('timezone test');
    const last = logger.getRecentLogs().slice(-1)[0];
    expect(last).toBeDefined();
    expect(last.timestamp).toMatch(/T/);
  });
});
