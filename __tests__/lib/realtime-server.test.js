/**
 * Tests for realtime-server module
 * Issue #83: Extract WebSocket Server Setup
 */

const { initializeWebSocketServer, initializeSSEServer } = require('../../lib/realtime-server');
const EventEmitter = require('events');

describe('realtime-server', () => {
    describe('initializeWebSocketServer', () => {
        let mockHttpServer, mockWsHub, mockDeviceStore, mockLogger;

        beforeEach(() => {
            mockHttpServer = {};
            mockWsHub = {
                init: jest.fn(),
            };
            mockDeviceStore = {
                verifyDevice: jest.fn(),
            };
            mockLogger = {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            };
        });

        it('should initialize WebSocket hub with correct options', () => {
            initializeWebSocketServer({
                httpServer: mockHttpServer,
                wsHub: mockWsHub,
                deviceStore: mockDeviceStore,
                logger: mockLogger,
            });

            expect(mockWsHub.init).toHaveBeenCalledWith(mockHttpServer, {
                path: '/ws/devices',
                verifyDevice: mockDeviceStore.verifyDevice,
            });
            expect(mockLogger.info).toHaveBeenCalledWith(
                '✅ WebSocket server initialized on /ws/devices'
            );
        });

        it('should handle initialization errors gracefully', () => {
            const error = new Error('WebSocket init failed');
            mockWsHub.init.mockImplementation(() => {
                throw error;
            });

            initializeWebSocketServer({
                httpServer: mockHttpServer,
                wsHub: mockWsHub,
                deviceStore: mockDeviceStore,
                logger: mockLogger,
            });

            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[WS] WebSocket initialization failed:',
                error.message
            );
        });
    });

    describe('initializeSSEServer', () => {
        let mockApp, mockLogger, mockReq, mockRes;

        beforeEach(() => {
            mockApp = {
                get: jest.fn(),
            };
            mockLogger = {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
                events: new EventEmitter(),
            };
            mockReq = {
                session: { user: { username: 'admin' } },
                on: jest.fn(),
            };
            mockRes = {
                setHeader: jest.fn(),
                flushHeaders: jest.fn(),
                write: jest.fn(),
                status: jest.fn().mockReturnThis(),
                end: jest.fn(),
            };

            // Clear globals
            delete global.__adminSSEBroadcast;
            delete global.__adminSSECleanup;
        });

        afterEach(() => {
            if (global.__adminSSECleanup) {
                global.__adminSSECleanup();
            }
        });

        it('should register SSE endpoint on /api/admin/events', () => {
            const result = initializeSSEServer({ app: mockApp, logger: mockLogger });

            expect(mockApp.get).toHaveBeenCalledWith('/api/admin/events', expect.any(Function));
            expect(mockLogger.info).toHaveBeenCalledWith(
                '✅ SSE server initialized on /api/admin/events'
            );
            expect(result).toHaveProperty('cleanup');
            expect(result).toHaveProperty('broadcast');
        });

        it('should set up global SSE broadcast function', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            expect(global.__adminSSEBroadcast).toBeDefined();
            expect(typeof global.__adminSSEBroadcast).toBe('function');
        });

        it('should set up global SSE cleanup function', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            expect(global.__adminSSECleanup).toBeDefined();
            expect(typeof global.__adminSSECleanup).toBe('function');
        });

        it('should reject unauthenticated SSE requests', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            // Get the registered route handler
            const routeHandler = mockApp.get.mock.calls[0][1];

            // Test without session
            const unauthReq = { session: null, on: jest.fn() };
            routeHandler(unauthReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.end).toHaveBeenCalled();
        });

        it('should accept authenticated SSE requests and set headers', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            // Get the registered route handler
            const routeHandler = mockApp.get.mock.calls[0][1];

            // Test with valid session
            routeHandler(mockReq, mockRes);

            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Type',
                'text/event-stream; charset=utf-8'
            );
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Cache-Control',
                'no-cache, no-transform'
            );
            expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
        });

        it('should send initial SSE messages', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            const routeHandler = mockApp.get.mock.calls[0][1];
            routeHandler(mockReq, mockRes);

            expect(mockRes.write).toHaveBeenCalledWith(': connected\n\n');
            expect(mockRes.write).toHaveBeenCalledWith('event: hello\n');
            expect(mockRes.write).toHaveBeenCalledWith(
                expect.stringMatching(/data: \{"t": \d+\}\n\n/)
            );
        });

        it('should broadcast events to SSE clients', () => {
            initializeSSEServer({ app: mockApp, logger: mockLogger });

            const routeHandler = mockApp.get.mock.calls[0][1];
            routeHandler(mockReq, mockRes);

            // Trigger a log event
            mockLogger.events.emit('log', { level: 'info', message: 'Test log' });

            // Check that write was called with log event
            expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('event: log'));
        });

        it('should cleanup SSE resources on cleanup call', () => {
            const result = initializeSSEServer({ app: mockApp, logger: mockLogger });

            const routeHandler = mockApp.get.mock.calls[0][1];
            routeHandler(mockReq, mockRes);

            // Create a log listener to verify cleanup
            const logListenerCount = mockLogger.events.listenerCount('log');
            expect(logListenerCount).toBeGreaterThan(0);

            // Call cleanup
            result.cleanup();

            // Verify listener was removed
            expect(mockLogger.events.listenerCount('log')).toBeLessThan(logListenerCount);
        });
    });
});
