/**
 * @jest-environment node
 */

const { isDebugMode, debugLog, createDebugLogger, debugOnly } = require('../../utils/debug');
const logger = require('../../utils/logger');

// Mock the logger
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
}));

describe('utils/debug', () => {
    const originalDebug = process.env.DEBUG;
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env.DEBUG = originalDebug;
        process.env.NODE_ENV = originalNodeEnv;
    });

    describe('isDebugMode()', () => {
        it('should return true when DEBUG=true', () => {
            process.env.DEBUG = 'true';
            process.env.NODE_ENV = 'production';
            expect(isDebugMode()).toBe(true);
        });

        it('should return true when NODE_ENV=development', () => {
            process.env.DEBUG = 'false';
            process.env.NODE_ENV = 'development';
            expect(isDebugMode()).toBe(true);
        });

        it('should return false when both are production values', () => {
            process.env.DEBUG = 'false';
            process.env.NODE_ENV = 'production';
            expect(isDebugMode()).toBe(false);
        });

        it('should return false when DEBUG is undefined', () => {
            delete process.env.DEBUG;
            process.env.NODE_ENV = 'production';
            expect(isDebugMode()).toBe(false);
        });
    });

    describe('debugLog()', () => {
        it('should call logger.debug when debug mode is enabled', () => {
            process.env.DEBUG = 'true';
            debugLog('Test message', { key: 'value' });
            expect(logger.debug).toHaveBeenCalledWith('Test message', { key: 'value' });
        });

        it('should not call logger.debug when debug mode is disabled', () => {
            process.env.DEBUG = 'false';
            process.env.NODE_ENV = 'production';
            debugLog('Test message');
            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should handle multiple arguments', () => {
            process.env.DEBUG = 'true';
            debugLog('Message', 'arg1', 'arg2', { data: true });
            expect(logger.debug).toHaveBeenCalledWith('Message', 'arg1', 'arg2', {
                data: true,
            });
        });
    });

    describe('createDebugLogger()', () => {
        it('should create a debug logger with module prefix', () => {
            process.env.DEBUG = 'true';
            const debug = createDebugLogger('TestModule');
            debug('Test message');
            expect(logger.debug).toHaveBeenCalledWith('[TestModule] Test message');
        });

        it('should handle non-string messages', () => {
            process.env.DEBUG = 'true';
            const debug = createDebugLogger('TestModule');
            const objMessage = { type: 'info' };
            debug(objMessage);
            expect(logger.debug).toHaveBeenCalledWith(objMessage);
        });

        it('should not log when debug mode is disabled', () => {
            process.env.DEBUG = 'false';
            process.env.NODE_ENV = 'production';
            const debug = createDebugLogger('TestModule');
            debug('Test message');
            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('should pass additional arguments to logger', () => {
            process.env.DEBUG = 'true';
            const debug = createDebugLogger('TestModule');
            debug('Message', { data: 123 }, 'extra');
            expect(logger.debug).toHaveBeenCalledWith(
                '[TestModule] Message',
                { data: 123 },
                'extra'
            );
        });
    });

    describe('debugOnly()', () => {
        it('should execute function when debug mode is enabled', () => {
            process.env.DEBUG = 'true';
            const fn = jest.fn(() => 'result');
            const result = debugOnly(fn);
            expect(fn).toHaveBeenCalled();
            expect(result).toBe('result');
        });

        it('should not execute function when debug mode is disabled', () => {
            process.env.DEBUG = 'false';
            process.env.NODE_ENV = 'production';
            const fn = jest.fn();
            const result = debugOnly(fn);
            expect(fn).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        });

        it('should return function result when executed', () => {
            process.env.DEBUG = 'true';
            const result = debugOnly(() => ({ computed: 'value' }));
            expect(result).toEqual({ computed: 'value' });
        });
    });
});
