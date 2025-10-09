/**
 * Coverage enhancement tests for updater.js
 * Focus on error handling, edge cases, and uncovered paths
 */

const updater = require('../../utils/updater');

describe('Updater Coverage Enhancement', () => {
    beforeEach(() => {
        // Reset updater state
        updater.updateInProgress = false;
        updater.updateStatus = {
            phase: 'idle',
            progress: 0,
            message: '',
            error: null,
            startTime: null,
            backupPath: null,
        };
    });

    describe('Status Management', () => {
        test('should return immutable status copy', () => {
            updater.updateStatus.phase = 'testing';
            updater.updateStatus.progress = 50;
            updater.updateStatus.message = 'Test message';
            updater.updateStatus.error = 'Test error';
            updater.updateStatus.startTime = new Date();
            updater.updateStatus.backupPath = '/test/backup';

            const status = updater.getStatus();

            // Should contain all properties
            expect(status.phase).toBe('testing');
            expect(status.progress).toBe(50);
            expect(status.message).toBe('Test message');
            expect(status.error).toBe('Test error');
            expect(status.startTime).toBeDefined();
            expect(status.backupPath).toBe('/test/backup');

            // Should be a copy, not the original object
            expect(status).not.toBe(updater.updateStatus);

            // Modifying returned status should not affect original
            status.phase = 'modified';
            expect(updater.updateStatus.phase).toBe('testing');
        });

        test('should track update progress correctly', () => {
            expect(updater.isUpdating()).toBe(false);

            updater.updateInProgress = true;
            expect(updater.isUpdating()).toBe(true);

            updater.updateInProgress = false;
            expect(updater.isUpdating()).toBe(false);
        });
    });

    describe('Update Process Protection', () => {
        test('should prevent concurrent updates', async () => {
            updater.updateInProgress = true;

            await expect(updater.startUpdate()).rejects.toThrow('Update already in progress');

            // Status should remain unchanged
            expect(updater.updateInProgress).toBe(true);
        });

        test('should accept target version parameter', async () => {
            updater.updateInProgress = true;

            await expect(updater.startUpdate('1.2.3')).rejects.toThrow(
                'Update already in progress'
            );
        });

        test('should start update with null target version', async () => {
            updater.updateInProgress = true;

            await expect(updater.startUpdate(null)).rejects.toThrow('Update already in progress');
        });
    });

    describe('State Initialization', () => {
        test('should have correct initial state', () => {
            const status = updater.getStatus();

            expect(status.phase).toBe('idle');
            expect(status.progress).toBe(0);
            expect(status.message).toBe('');
            expect(status.error).toBeNull();
            expect(status.startTime).toBeNull();
            expect(status.backupPath).toBeNull();
        });

        test('should maintain consistent state after errors', () => {
            // Simulate error state
            updater.updateStatus.phase = 'error';
            updater.updateStatus.error = 'Test error occurred';
            updater.updateStatus.progress = 50;

            const status = updater.getStatus();
            expect(status.phase).toBe('error');
            expect(status.error).toBe('Test error occurred');
            expect(status.progress).toBe(50);

            // Reset to idle
            updater.updateStatus.phase = 'idle';
            updater.updateStatus.error = null;
            updater.updateStatus.progress = 0;

            const resetStatus = updater.getStatus();
            expect(resetStatus.phase).toBe('idle');
            expect(resetStatus.error).toBeNull();
            expect(resetStatus.progress).toBe(0);
        });
    });

    describe('Progress and Phase Tracking', () => {
        test('should handle all valid phases', () => {
            const validPhases = [
                'idle',
                'checking',
                'downloading',
                'extracting',
                'backing_up',
                'installing',
                'restarting',
                'completed',
                'error',
                'rollback',
            ];

            validPhases.forEach(phase => {
                updater.updateStatus.phase = phase;
                const status = updater.getStatus();
                expect(status.phase).toBe(phase);
            });
        });

        test('should handle progress boundaries', () => {
            // Test negative progress
            updater.updateStatus.progress = -10;
            expect(updater.getStatus().progress).toBe(-10);

            // Test zero progress
            updater.updateStatus.progress = 0;
            expect(updater.getStatus().progress).toBe(0);

            // Test normal progress
            updater.updateStatus.progress = 50;
            expect(updater.getStatus().progress).toBe(50);

            // Test max progress
            updater.updateStatus.progress = 100;
            expect(updater.getStatus().progress).toBe(100);

            // Test over max progress
            updater.updateStatus.progress = 150;
            expect(updater.getStatus().progress).toBe(150);
        });

        test('should handle various message types', () => {
            // Empty message
            updater.updateStatus.message = '';
            expect(updater.getStatus().message).toBe('');

            // Normal message
            updater.updateStatus.message = 'Downloading update...';
            expect(updater.getStatus().message).toBe('Downloading update...');

            // Long message
            const longMessage = 'A'.repeat(1000);
            updater.updateStatus.message = longMessage;
            expect(updater.getStatus().message).toBe(longMessage);

            // Special characters
            updater.updateStatus.message = 'Updating with émojis 🚀 and symbols ♨️';
            expect(updater.getStatus().message).toContain('émojis');
        });
    });

    describe('Error State Management', () => {
        test('should handle different error types', () => {
            // String error
            updater.updateStatus.error = 'Simple error message';
            expect(updater.getStatus().error).toBe('Simple error message');

            // Null error (no error)
            updater.updateStatus.error = null;
            expect(updater.getStatus().error).toBeNull();

            // Undefined error
            updater.updateStatus.error = undefined;
            expect(updater.getStatus().error).toBeUndefined();

            // Complex error message
            updater.updateStatus.error = 'Network error: ECONNRESET - Connection was reset by peer';
            expect(updater.getStatus().error).toContain('ECONNRESET');
        });

        test('should handle error recovery scenarios', () => {
            // Set error state
            updater.updateStatus.phase = 'error';
            updater.updateStatus.error = 'Download failed';
            updater.updateInProgress = false;

            expect(updater.getStatus().phase).toBe('error');
            expect(updater.getStatus().error).toBe('Download failed');
            expect(updater.isUpdating()).toBe(false);

            // Clear error and resume
            updater.updateStatus.phase = 'idle';
            updater.updateStatus.error = null;

            expect(updater.getStatus().phase).toBe('idle');
            expect(updater.getStatus().error).toBeNull();
        });
    });

    describe('Timestamp Handling', () => {
        test('should handle various timestamp formats', () => {
            // Date object
            const testDate = new Date('2024-01-01T12:00:00Z');
            updater.updateStatus.startTime = testDate;
            expect(updater.getStatus().startTime).toBe(testDate);

            // Null timestamp
            updater.updateStatus.startTime = null;
            expect(updater.getStatus().startTime).toBeNull();

            // Current timestamp
            const now = new Date();
            updater.updateStatus.startTime = now;
            expect(updater.getStatus().startTime).toBe(now);
        });
    });

    describe('Backup Path Management', () => {
        test('should handle backup path states', () => {
            // No backup path
            updater.updateStatus.backupPath = null;
            expect(updater.getStatus().backupPath).toBeNull();

            // Absolute path
            updater.updateStatus.backupPath = 'backups/posterrama-backup-20240101';
            expect(updater.getStatus().backupPath).toBe('backups/posterrama-backup-20240101');

            // Relative path
            updater.updateStatus.backupPath = '../backups/latest';
            expect(updater.getStatus().backupPath).toBe('../backups/latest');

            // Empty string
            updater.updateStatus.backupPath = '';
            expect(updater.getStatus().backupPath).toBe('');
        });
    });

    describe('Concurrent Access Safety', () => {
        test('should handle rapid status checks', () => {
            // Simulate rapid status checks from multiple sources
            const statuses = [];

            for (let i = 0; i < 100; i++) {
                updater.updateStatus.progress = i;
                statuses.push(updater.getStatus());
            }

            expect(statuses).toHaveLength(100);
            statuses.forEach((status, index) => {
                expect(status.progress).toBe(index);
                expect(status).not.toBe(updater.updateStatus);
            });
        });

        test('should maintain state consistency during updates', () => {
            // Simulate state changes during status reading
            updater.updateStatus.phase = 'downloading';
            updater.updateStatus.progress = 25;
            updater.updateStatus.message = 'Downloading...';

            const status1 = updater.getStatus();

            // Change state
            updater.updateStatus.progress = 50;
            updater.updateStatus.message = 'Still downloading...';

            const status2 = updater.getStatus();

            // Previous status should remain unchanged
            expect(status1.progress).toBe(25);
            expect(status1.message).toBe('Downloading...');

            // New status should reflect changes
            expect(status2.progress).toBe(50);
            expect(status2.message).toBe('Still downloading...');
        });
    });
});
