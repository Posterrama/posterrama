const request = require('supertest');
const express = require('express');

const adminLogsRouter = require('../../routes/admin-logs');
const logger = require('../../utils/logger');

describe('Admin logs API: circular-safe JSON', () => {
    test('GET /api/admin/logs returns 200 even with circular metadata', async () => {
        // Seed a circular log entry into the in-memory buffer.
        const circ = {};
        circ.self = circ;

        // Ensure buffer exists
        if (!Array.isArray(logger.memoryLogs)) {
            throw new Error('logger.memoryLogs not available');
        }

        logger.memoryLogs.push({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message: '[TEST-LOG] circular meta',
            meta: circ,
        });

        const app = express();
        // In production, server mounts isAuthenticated before this router.
        // For this unit test, mount it directly.
        app.use('/api/admin', adminLogsRouter);

        const res = await request(app).get('/api/admin/logs?limit=10');

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.logs)).toBe(true);

        // The sanitization should have replaced the circular reference.
        const found = res.body.logs.find(l => String(l.message || '').includes('circular meta'));
        expect(found).toBeTruthy();
        expect(found.meta).toBeTruthy();
    });

    test('GET /api/admin/logs?level=warn returns 200 even with toxic metadata', async () => {
        const toxic = {};
        Object.defineProperty(toxic, 'boom', {
            enumerable: true,
            get() {
                throw new Error('getter exploded');
            },
        });

        logger.memoryLogs.push({
            timestamp: new Date().toISOString(),
            level: 'WARN',
            message: '[TEST-LOG] toxic meta',
            meta: toxic,
        });

        const app = express();
        app.use('/api/admin', adminLogsRouter);

        const res = await request(app).get('/api/admin/logs?level=warn&limit=10');
        expect(res.status).toBe(200);
        expect(res.body?.success).toBe(true);
        // Should still include the WARN entry; meta may be replaced/truncated.
        const found = res.body.logs.find(l => String(l.message || '').includes('toxic meta'));
        expect(found).toBeTruthy();
    });
});
