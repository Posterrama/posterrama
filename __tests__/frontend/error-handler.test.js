/**
 * Tests for error-handler.js
 * Global error handling and telemetry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('error-handler.js', () => {
    let dom;
    let window;
    let document;
    let errorHandler;

    beforeEach(async () => {
        // Create fresh DOM for each test
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost:4000',
            runScripts: 'dangerously',
            resources: 'usable',
        });
        window = dom.window;
        document = window.document;

        // Make DOM globals available
        global.window = window;
        global.document = document;
        global.navigator = window.navigator;
        global.fetch = vi.fn();

        // Clear module cache to get fresh instance
        vi.resetModules();

        // Import error-handler (will auto-initialize)
        errorHandler = await import('../../public/error-handler.js');
    });

    afterEach(() => {
        dom.window.close();
        vi.clearAllMocks();
    });

    describe('sanitizeError', () => {
        it('should sanitize error objects with all properties', async () => {
            const testError = new Error('Test error message');
            testError.stack = 'Error: Test error\n  at test.js:10:15';

            // Trigger error to see sanitization
            window.dispatchEvent(
                new window.ErrorEvent('error', {
                    error: testError,
                    message: 'Test error message',
                    filename: 'test.js',
                    lineno: 10,
                    colno: 15,
                })
            );

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/telemetry/error',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData).toMatchObject({
                message: 'Test error message',
                type: 'Error',
                url: 'http://localhost:4000/',
                filename: 'test.js',
                lineno: 10,
                colno: 15,
            });
            expect(errorData.timestamp).toBeDefined();
            expect(errorData.userAgent).toBeDefined();
            expect(errorData.stack).toContain('Error: Test error');
        });

        it('should truncate very long error messages', async () => {
            const longMessage = 'A'.repeat(2000);
            const testError = new Error(longMessage);

            window.dispatchEvent(
                new window.ErrorEvent('error', {
                    error: testError,
                    message: longMessage,
                })
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData.message.length).toBe(1000); // MAX_ERROR_LENGTH
        });

        it('should handle errors without stack traces', async () => {
            const simpleError = { message: 'Simple error', name: 'CustomError' };

            window.dispatchEvent(
                new window.ErrorEvent('error', {
                    error: simpleError,
                    message: 'Simple error',
                })
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData.message).toBe('Simple error');
            expect(errorData.type).toBe('CustomError');
            expect(errorData.stack).toBeUndefined();
        });
    });

    describe('Rate Limiting', () => {
        it('should stop sending errors after MAX_ERRORS_PER_SESSION', async () => {
            // Trigger 51 errors (max is 50)
            for (let i = 0; i < 51; i++) {
                window.dispatchEvent(
                    new window.ErrorEvent('error', {
                        error: new Error(`Error ${i}`),
                        message: `Error ${i}`,
                    })
                );
            }

            await new Promise(resolve => setTimeout(resolve, 200));

            // Should only send 50 errors
            expect(global.fetch).toHaveBeenCalledTimes(50);
        });

        it('should log warning when rate limit is reached', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // Trigger 51 errors
            for (let i = 0; i < 51; i++) {
                window.dispatchEvent(
                    new window.ErrorEvent('error', {
                        error: new Error(`Error ${i}`),
                        message: `Error ${i}`,
                    })
                );
            }

            await new Promise(resolve => setTimeout(resolve, 200));

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Max errors per session reached')
            );

            consoleWarnSpy.mockRestore();
        });
    });

    describe('handleUnhandledRejection', () => {
        it('should catch unhandled promise rejections', async () => {
            const rejectionReason = new Error('Promise rejected');

            window.dispatchEvent(
                new window.PromiseRejectionEvent('unhandledrejection', {
                    reason: rejectionReason,
                    promise: Promise.reject(rejectionReason),
                })
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/telemetry/error',
                expect.objectContaining({
                    method: 'POST',
                })
            );

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData.message).toBe('Promise rejected');
            expect(errorData.promiseRejection).toBe(true);
        });

        it('should handle rejections with non-Error reasons', async () => {
            window.dispatchEvent(
                new window.PromiseRejectionEvent('unhandledrejection', {
                    reason: 'String rejection reason',
                    promise: Promise.reject('String rejection reason'),
                })
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData.message).toContain('String rejection reason');
            expect(errorData.promiseRejection).toBe(true);
        });
    });

    describe('logError (manual logging)', () => {
        it('should allow manual error logging with context', async () => {
            const testError = new Error('Manual error');
            const context = { userId: '123', action: 'save-settings' };

            errorHandler.logError(testError, context);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/telemetry/error',
                expect.objectContaining({
                    method: 'POST',
                })
            );

            const fetchCall = global.fetch.mock.calls[0];
            const errorData = JSON.parse(fetchCall[1].body);

            expect(errorData.message).toBe('Manual error');
            expect(errorData.userId).toBe('123');
            expect(errorData.action).toBe('save-settings');
            expect(errorData.manual).toBe(true);
        });
    });

    describe('Fetch Failures', () => {
        it('should not throw when fetch fails', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

            window.dispatchEvent(
                new window.ErrorEvent('error', {
                    error: new Error('Test error'),
                    message: 'Test error',
                })
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should not throw, just log debug message
            expect(consoleDebugSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to send error to server'),
                expect.any(String)
            );

            consoleDebugSpy.mockRestore();
        });
    });

    describe('Initialization', () => {
        it('should auto-initialize when imported', () => {
            // Error handlers should be registered (tested by other tests working)
            expect(errorHandler.initErrorHandlers).toBeDefined();
            expect(errorHandler.logError).toBeDefined();
        });

        it('should log initialization message', async () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Re-import to trigger initialization
            vi.resetModules();
            await import('../../public/error-handler.js');

            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Global error handlers initialized')
            );

            consoleLogSpy.mockRestore();
        });
    });
});
