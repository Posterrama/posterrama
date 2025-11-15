/**
 * Configuration Backup Routes
 * Handles config backup/restore operations and automated scheduling
 */

const express = require('express');

// Backup scheduler timer
let __cfgBackupTimer = null;

/**
 * Create config backups router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Function} deps.isAuthenticated - Authentication middleware
 * @param {Object} deps.logger - Logger instance
 * @param {Array<string>} deps.CFG_FILES - Whitelisted config files
 * @param {Function} deps.cfgListBackups - List backups function
 * @param {Function} deps.cfgCreateBackup - Create backup function
 * @param {Function} deps.cfgCleanupOld - Cleanup old backups function
 * @param {Function} deps.cfgRestoreFile - Restore file function
 * @param {Function} deps.cfgDeleteBackup - Delete backup function
 * @param {Function} deps.cfgUpdateBackupMeta - Update backup metadata function
 * @param {Function} deps.cfgReadSchedule - Read schedule config function
 * @param {Function} deps.cfgWriteSchedule - Write schedule config function
 * @param {Function} deps.broadcastAdminEvent - Broadcast admin event function
 * @returns {express.Router} Configured router
 */
module.exports = function createConfigBackupsRouter({
    isAuthenticated,
    logger,
    CFG_FILES,
    cfgListBackups,
    cfgCreateBackup,
    cfgCleanupOld,
    cfgRestoreFile,
    cfgDeleteBackup,
    cfgUpdateBackupMeta,
    cfgReadSchedule,
    cfgWriteSchedule,
    broadcastAdminEvent,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /api/admin/config-backups:
     *   get:
     *     summary: List configuration backups
     *     description: Returns a list of available configuration backups with their files and metadata.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: List of backups
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupListResponse'
     */
    router.get('/api/admin/config-backups', isAuthenticated, async (req, res) => {
        try {
            const list = await cfgListBackups();
            res.set('Cache-Control', 'no-store');
            res.json(list);
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to list backups' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups:
     *   post:
     *     summary: Create a new configuration backup
     *     description: Creates a new backup of whitelisted configuration files (config.json, .env, devices/groups, presets). Optionally include a label and note for documentation.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               label:
     *                 type: string
     *                 maxLength: 100
     *                 description: Optional label for the backup (e.g., "Before v2.9.5 update")
     *                 example: "Before major config change"
     *               note:
     *                 type: string
     *                 maxLength: 500
     *                 description: Optional detailed note about this backup
     *                 example: "Created before enabling MQTT integration"
     *     responses:
     *       200:
     *         description: Backup metadata
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupCreateResponse'
     */
    router.post('/api/admin/config-backups', isAuthenticated, async (req, res) => {
        try {
            const options = {};
            if (req.body?.label) options.label = req.body.label;
            if (req.body?.note) options.note = req.body.note;
            const meta = await cfgCreateBackup(options);
            try {
                broadcastAdminEvent?.('backup-created', meta);
            } catch (_) {
                /* best-effort admin event */
            }
            res.json(meta);
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to create backup' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/cleanup:
     *   post:
     *     summary: Cleanup old backups
     *     description: Deletes older backups while keeping the most recent N backups (default 5).
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               keep:
     *                 type: integer
     *                 minimum: 1
     *                 maximum: 60
     *                 default: 5
     *     responses:
     *       200:
     *         description: Cleanup result
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupCleanupResponse'
     */
    router.post('/api/admin/config-backups/cleanup', isAuthenticated, async (req, res) => {
        try {
            const keep = Math.max(1, Math.min(60, Number(req.body?.keep || 5)));
            const result = await cfgCleanupOld(keep);
            try {
                broadcastAdminEvent?.('backup-cleanup', { keep, ...result });
            } catch (_) {
                /* best-effort admin event */
            }
            res.json({ keep, ...result });
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Cleanup failed' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/restore:
     *   post:
     *     summary: Restore a file from a backup
     *     description: Restores a whitelisted file (e.g., config.json or .env) from a specified backup.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [backupId, file]
     *             properties:
     *               backupId:
     *                 type: string
     *               file:
     *                 type: string
     *                 enum: ['config.json', 'device-presets.json', 'devices.json', 'groups.json', '.env']
     *     responses:
     *       200:
     *         description: Restore successful
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupRestoreResponse'
     *       400:
     *         description: Invalid request or restore failed
     */
    router.post('/api/admin/config-backups/restore', isAuthenticated, async (req, res) => {
        const id = String(req.body?.backupId || '');
        const file = String(req.body?.file || '');
        try {
            if (!id) throw new Error('Missing backupId');
            if (!CFG_FILES.includes(file)) throw new Error('Invalid file');
            await cfgRestoreFile(id, file);
            try {
                broadcastAdminEvent?.('backup-restored', { id, file });
            } catch (_) {
                /* best-effort admin event */
            }
            // If config.json changed, also broadcast a config-updated event
            if (file === 'config.json') {
                try {
                    broadcastAdminEvent?.('config-updated', {
                        t: Date.now(),
                        source: 'restore',
                    });
                } catch (_) {
                    /* best-effort admin event */
                }
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ error: e?.message || 'Restore failed' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/{id}:
     *   delete:
     *     summary: Delete a specific backup
     *     description: Permanently deletes a backup directory by ID.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Deletion result
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupDeleteResponse'
     *       400:
     *         description: Invalid ID or deletion failed
     */
    router.delete('/api/admin/config-backups/:id', isAuthenticated, async (req, res) => {
        const id = String(req.params.id || '');
        try {
            if (!id) throw new Error('Missing id');
            await cfgDeleteBackup(id);
            try {
                broadcastAdminEvent?.('backup-deleted', { id });
            } catch (_) {
                /* best-effort admin event */
            }
            res.json({ ok: true, id });
        } catch (e) {
            res.status(400).json({ error: e?.message || 'Delete failed' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/{id}:
     *   patch:
     *     summary: Update backup label and note
     *     description: Edit the label and/or note of an existing backup. Pass null or empty string to remove a field.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               label:
     *                 type: string
     *                 maxLength: 100
     *                 description: New label (null/empty to remove)
     *                 nullable: true
     *                 example: "Pre-v2.9.5 stable"
     *               note:
     *                 type: string
     *                 maxLength: 500
     *                 description: New note (null/empty to remove)
     *                 nullable: true
     *                 example: "Backup before MQTT integration testing"
     *     responses:
     *       200:
     *         description: Updated metadata
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupUpdateResponse'
     *       400:
     *         description: Invalid ID or update failed
     */
    router.patch('/api/admin/config-backups/:id', isAuthenticated, async (req, res) => {
        const id = String(req.params.id || '');
        try {
            if (!id) throw new Error('Missing id');
            const updates = {};
            if ('label' in req.body) updates.label = req.body.label;
            if ('note' in req.body) updates.note = req.body.note;
            const meta = await cfgUpdateBackupMeta(id, updates);
            try {
                broadcastAdminEvent?.('backup-updated', { id, ...updates });
            } catch (_) {
                /* best-effort admin event */
            }
            res.json(meta);
        } catch (e) {
            res.status(400).json({ error: e?.message || 'Update failed' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/schedule:
     *   get:
     *     summary: Read backup schedule configuration
     *     description: Returns current daily schedule for automatic backups (enabled flag, time, and retention).
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Schedule configuration
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BackupScheduleResponse'
     */
    router.get('/api/admin/config-backups/schedule', isAuthenticated, async (req, res) => {
        try {
            const cfg = await cfgReadSchedule();
            res.set('Cache-Control', 'no-store');
            res.json(cfg);
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to read schedule' });
        }
    });

    /**
     * @swagger
     * /api/admin/config-backups/schedule:
     *   post:
     *     summary: Update backup schedule configuration
     *     description: Saves daily backup scheduler configuration and realigns the in-memory scheduler.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               enabled:
     *                 type: boolean
     *                 description: Enable or disable automated backups
     *                 example: true
     *               time:
     *                 type: string
     *                 pattern: '^\d{1,2}:\d{2}$'
     *                 description: Daily backup time in HH:MM format (24-hour)
     *                 example: '03:30'
     *               retention:
     *                 type: integer
     *                 minimum: 1
     *                 maximum: 60
     *                 description: Number of backups to retain
     *                 example: 5
     */
    router.post('/api/admin/config-backups/schedule', isAuthenticated, async (req, res) => {
        try {
            const out = await cfgWriteSchedule(req.body || {});
            // Re-align scheduler after saving
            try {
                await scheduleConfigBackups();
            } catch (_) {
                /* ignore scheduler realign failure */
            }
            res.json(out);
        } catch (e) {
            res.status(400).json({ error: e?.message || 'Failed to save schedule' });
        }
    });

    /**
     * Schedule daily config backups based on configuration
     * @returns {Promise<void>}
     */
    async function scheduleConfigBackups() {
        try {
            if (__cfgBackupTimer) clearTimeout(__cfgBackupTimer);
        } catch (_) {
            /* ignore missing/invalid timer */
        }
        const parseTime = t => {
            const m = String(t || '02:30').match(/^(\d{1,2}):(\d{2})$/);
            const hh = Math.max(0, Math.min(23, Number(m?.[1] || 2)));
            const mm = Math.max(0, Math.min(59, Number(m?.[2] || 30)));
            return { hh, mm };
        };
        const cfg = await cfgReadSchedule();
        if (cfg.enabled === false) {
            logger.info('[cfg-backup] scheduler disabled');
            return;
        }
        const { hh, mm } = parseTime(cfg.time);
        const now = new Date();
        const next = new Date(now);
        next.setHours(hh, mm, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const ms = next - now;
        __cfgBackupTimer = setTimeout(async function runBackup() {
            try {
                const meta = await cfgCreateBackup();
                try {
                    await cfgCleanupOld(cfg.retention || 5);
                } catch (_) {
                    /* ignore cleanup errors; proceed */
                }
                try {
                    broadcastAdminEvent('backup-created', meta);
                } catch (_) {
                    /* best-effort admin event */
                }
            } catch (e) {
                logger.warn('[cfg-backup] scheduled backup failed', e?.message || e);
            } finally {
                // schedule next run
                scheduleConfigBackups();
            }
        }, ms);
        logger.info(`[cfg-backup] next backup scheduled at ${next.toISOString()}`);
    }

    // Export the scheduler function so it can be initialized from server.js
    router.scheduleConfigBackups = scheduleConfigBackups;

    return router;
};
