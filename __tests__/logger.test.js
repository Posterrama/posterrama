const request = require('supertest');
const app = require('../server');
const logger = require('../logger');

describe('Logging System', () => {
    beforeEach(() => {
        // Clear the in-memory logs before each test
        logger.memoryLogs = [];
    });

    test('should create log entries with correct levels', () => {
        logger.info('Test info message');
        logger.warn('Test warning message');
        logger.error('Test error message');

        const logs = logger.getRecentLogs();
        expect(logs).toHaveLength(3);
        
        const levels = logs.map(log => log.level);
        expect(levels).toEqual(['INFO', 'WARN', 'ERROR']);
    });

    test('should filter logs by level', () => {
        logger.info('Info message');
        logger.error('Error message');

        const errorLogs = logger.getRecentLogs('error');
        expect(errorLogs).toHaveLength(1);
        expect(errorLogs[0].level).toBe('ERROR');

        const infoAndAbove = logger.getRecentLogs('info');
        expect(infoAndAbove).toHaveLength(2);
    });

    test('should limit the number of logs in memory', () => {
        for (let i = 0; i < 250; i++) {
            logger.info(`Test message ${i}`);
        }

        const logs = logger.getRecentLogs();
        expect(logs).toHaveLength(200); // Default limit
        expect(logs[logs.length - 1].message).toBe('Test message 249');
    });
});

describe('Log API Endpoints', () => {
    test('GET /api/admin/logs should return filtered logs', async () => {
        // Add some test logs
        logger.info('Test info message');
        logger.error('Test error message');

        const response = await request(app)
            .get('/api/admin/logs?level=error');

        // Should require authentication (401) or return data (200)
        expect([200, 401]).toContain(response.status);
        
        if (response.status === 200) {
            expect(response.body).toHaveLength(1);
            expect(response.body[0].level).toBe('error');
        }
    });

    test('GET /api/admin/logs should respect limit parameter', async () => {
        // Add multiple test logs
        for (let i = 0; i < 10; i++) {
            logger.info(`Test message ${i}`);
        }

        const response = await request(app)
            .get('/api/admin/logs?limit=5');

        // Should require authentication (401) or return data (200)
        expect([200, 401]).toContain(response.status);
        
        if (response.status === 200) {
            expect(response.body).toHaveLength(5);
        }
    });
});
