/**
 * Tests for audit trail feature (#71/#62)
 */

const path = require('path');
const fs = require('fs').promises;
const { auditLog, getAuditContext, auditLogger } = require('../../utils/auditLogger');

describe('Backup Audit Trail (#71/#62)', () => {
    const logDir = path.join(__dirname, '..', '..', 'logs');
    const testLogPattern = /backup-audit-\d{4}-\d{2}-\d{2}\.log$/;

    beforeAll(async () => {
        // Ensure logs directory exists
        await fs.mkdir(logDir, { recursive: true });
    });

    afterAll(async () => {
        // Clean up test logs
        try {
            const files = await fs.readdir(logDir);
            for (const file of files) {
                if (testLogPattern.test(file)) {
                    await fs.unlink(path.join(logDir, file)).catch(() => {});
                }
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe('Audit logger utility', () => {
        it('should log backup operations with correct structure', async () => {
            const action = 'backup.created';
            const details = {
                backupId: '20251116-120000',
                files: 5,
                trigger: 'manual',
            };
            const context = {
                user: 'testadmin',
                ip: '127.0.0.1',
            };

            auditLog(action, details, context);

            // Allow time for async write
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify log file exists
            const files = await fs.readdir(logDir);
            const logFile = files.find(f => testLogPattern.test(f));
            expect(logFile).toBeDefined();

            if (logFile) {
                const content = await fs.readFile(path.join(logDir, logFile), 'utf8');
                const lines = content.trim().split('\n');
                const lastLine = JSON.parse(lines[lines.length - 1]);

                expect(lastLine.action).toBe(action);
                expect(lastLine.backupId).toBe(details.backupId);
                expect(lastLine.files).toBe(details.files);
                expect(lastLine.user).toBe(context.user);
                expect(lastLine.ip).toBe(context.ip);
                expect(lastLine.timestamp).toBeDefined();
            }
        });

        it('should handle missing context gracefully', () => {
            expect(() => {
                auditLog('backup.restored', { backupId: 'test', fileName: 'config.json' });
            }).not.toThrow();
        });

        it('should extract audit context from Express request', () => {
            const mockReq = {
                user: { username: 'admin', email: 'admin@test.com' },
                ip: '192.168.1.100',
            };

            const context = getAuditContext(mockReq);

            expect(context.user).toBe('admin');
            expect(context.ip).toBe('192.168.1.100');
        });

        it('should handle requests without user', () => {
            const mockReq = { ip: '127.0.0.1' };
            const context = getAuditContext(mockReq);

            expect(context.user).toBe('admin'); // default fallback
            expect(context.ip).toBe('127.0.0.1');
        });
    });

    describe('Audit log integration', () => {
        it('should log different backup operations', async () => {
            const operations = [
                {
                    action: 'backup.created',
                    details: { backupId: '20251116-120000', trigger: 'auto' },
                },
                {
                    action: 'backup.restored',
                    details: { backupId: '20251116-120000', fileName: 'config.json' },
                },
                {
                    action: 'backup.deleted',
                    details: { backupId: '20251116-120000', reason: 'manual' },
                },
                {
                    action: 'backup.cleanup',
                    details: { deleted: 3, kept: 5, keep: 5, maxAgeDays: 30 },
                },
            ];

            operations.forEach(op => {
                auditLog(op.action, op.details, { user: 'test', ip: '127.0.0.1' });
            });

            // Allow time for async writes
            await new Promise(resolve => setTimeout(resolve, 200));

            const files = await fs.readdir(logDir);
            const logFile = files.find(f => testLogPattern.test(f));
            expect(logFile).toBeDefined();
        });

        it('should use JSON format for structured querying', async () => {
            auditLog(
                'backup.created',
                { backupId: 'json-test', files: 3 },
                { user: 'admin', ip: '127.0.0.1' }
            );

            await new Promise(resolve => setTimeout(resolve, 100));

            const files = await fs.readdir(logDir);
            const logFile = files.find(f => testLogPattern.test(f));

            if (logFile) {
                const content = await fs.readFile(path.join(logDir, logFile), 'utf8');
                const lines = content.trim().split('\n');

                // Verify each line is valid JSON
                lines.forEach(line => {
                    if (line.trim()) {
                        expect(() => JSON.parse(line)).not.toThrow();
                    }
                });
            }
        });
    });

    describe('Audit logger configuration', () => {
        it('should have daily rotation configured', () => {
            const transport = auditLogger.transports[0];
            expect(transport.filename).toContain('backup-audit');
            expect(transport.datePattern).toBe('YYYY-MM-DD');
            expect(transport.maxFiles).toBe('30d');
        });

        it('should use JSON format', () => {
            const formats = auditLogger.format._formatters;
            const hasJsonFormat = formats.some(f => f.constructor.name === 'Json');
            expect(hasJsonFormat).toBe(true);
        });
    });
});
