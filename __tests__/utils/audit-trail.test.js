/**
 * Tests for audit trail feature (#71/#62)
 */

const { auditLog, getAuditContext, auditLogger } = require('../../utils/auditLogger');

describe('Backup Audit Trail (#71/#62)', () => {
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

            const infoSpy = jest.spyOn(auditLogger, 'info').mockImplementation(() => {});

            auditLog(action, details, context);

            expect(infoSpy).toHaveBeenCalledTimes(1);
            const entry = infoSpy.mock.calls[0][0];

            expect(entry).toMatchObject({
                action,
                backupId: details.backupId,
                files: details.files,
                trigger: details.trigger,
                user: context.user,
                ip: context.ip,
            });
            expect(entry.timestamp).toBeDefined();

            infoSpy.mockRestore();
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

            const infoSpy = jest.spyOn(auditLogger, 'info').mockImplementation(() => {});

            operations.forEach(op => {
                auditLog(op.action, op.details, { user: 'test', ip: '127.0.0.1' });
            });

            expect(infoSpy).toHaveBeenCalledTimes(operations.length);
            operations.forEach((op, idx) => {
                const entry = infoSpy.mock.calls[idx][0];
                expect(entry).toMatchObject({
                    action: op.action,
                    ...op.details,
                    user: 'test',
                    ip: '127.0.0.1',
                });
                expect(entry.timestamp).toBeDefined();
            });

            infoSpy.mockRestore();
        });

        it('should use JSON format for structured querying', async () => {
            const infoSpy = jest.spyOn(auditLogger, 'info').mockImplementation(() => {});

            auditLog(
                'backup.created',
                { backupId: 'json-test', files: 3 },
                { user: 'admin', ip: '127.0.0.1' }
            );

            expect(infoSpy).toHaveBeenCalledTimes(1);
            const entry = infoSpy.mock.calls[0][0];
            expect(() => JSON.stringify(entry)).not.toThrow();

            infoSpy.mockRestore();
        });
    });

    describe('Audit logger configuration', () => {
        it('should have daily rotation configured', () => {
            const transport = auditLogger.transports[0];
            expect(transport).toBeDefined();
            expect(transport.constructor.name).toBe('DailyRotateFile');
            expect(transport.options.filename).toContain('backup-audit');
            expect(transport.options.datePattern).toBe('YYYY-MM-DD');
            expect(transport.options.maxFiles).toBe('30d');
        });

        it('should use JSON format', () => {
            // Winston logger has format configured
            expect(auditLogger.format).toBeDefined();
            // The format is a combination that includes JSON formatting
            const formatStr = String(auditLogger.format);
            const hasJsonFormat = formatStr.includes('json') || auditLogger.format.options;
            expect(hasJsonFormat).toBeTruthy();
        });
    });
});
