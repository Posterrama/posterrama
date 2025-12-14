/**
 * Device Profiles Management Routes
 *
 * Handles profile CRUD operations and live-apply when profiles are updated.
 * Profiles are reusable settings bundles that can be assigned to devices.
 *
 * @module routes/profiles
 */

const express = require('express');
const router = express.Router();
const profilesStore = require('../utils/profilesStore');
const deviceStore = require('../utils/deviceStore');
const wsHub = require('../utils/wsHub');
const deepMerge = require('../utils/deep-merge');

/**
 * Middleware factory to get dependencies from server.js
 * @param {Object} deps - Dependencies
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @param {Object} deps.cacheManager - Cache manager instance
 * @returns {express.Router} Configured router
 */
module.exports = function createProfilesRouter({ adminAuth, cacheManager }) {
    /**
     * @swagger
     * /api/profiles:
     *   get:
     *     summary: List all profiles
     *     description: Returns all device profiles with their settings.
     *     tags: ['Profiles', 'Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Profiles array
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items: { $ref: '#/components/schemas/Profile' }
     *             example:
     *               - id: living-room-4k
     *                 name: Living Room 4K
     *                 description: Optimized for 4K TV
     *                 settings: { cinemaMode: true }
     *       401:
     *         description: Unauthorized
     *       500:
     *         description: Profiles list failed
     */
    router.get('/', adminAuth, async (_req, res) => {
        try {
            const list = await profilesStore.getAll();
            res.json(list);
        } catch (e) {
            res.status(500).json({ error: 'profiles_list_failed' });
        }
    });

    /**
     * @swagger
     * /api/profiles/{id}:
     *   get:
     *     summary: Get a single profile
     *     tags: ['Profiles', 'Admin']
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
     *         description: Profile object
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Profile' }
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Not found
     */
    router.get('/:id', adminAuth, async (req, res) => {
        try {
            const profile = await profilesStore.getById(req.params.id);
            if (!profile) return res.status(404).json({ error: 'not_found' });
            res.json(profile);
        } catch (e) {
            res.status(500).json({ error: 'profile_get_failed' });
        }
    });

    /**
     * @swagger
     * /api/profiles:
     *   post:
     *     summary: Create a profile
     *     tags: ['Profiles', 'Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ProfileCreateRequest'
     *           examples:
     *             basic:
     *               summary: Basic profile
     *               value:
     *                 name: Living Room
     *                 description: 4K TV settings
     *             with_settings:
     *               summary: Profile with settings
     *               value:
     *                 name: Cinema Display
     *                 description: Cinema mode enabled
     *                 settings:
     *                   cinemaMode: true
     *                   transitionDuration: 1200
     *     responses:
     *       201:
     *         description: Created profile
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Profile' }
     *       401:
     *         description: Unauthorized
     *       409:
     *         description: Profile exists
     *       500:
     *         description: Profile create failed
     */
    router.post('/', adminAuth, express.json(), async (req, res) => {
        try {
            const { id, name, description, settings } = req.body || {};
            const profile = await profilesStore.createProfile({
                id,
                name,
                description,
                settings,
            });

            // Invalidate cached /get-config
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }

            res.status(201).json(profile);
        } catch (e) {
            if (e && e.message === 'profile_exists') {
                return res.status(409).json({ error: 'profile_exists' });
            }
            res.status(500).json({ error: 'profile_create_failed' });
        }
    });

    /**
     * @swagger
     * /api/profiles/{id}:
     *   patch:
     *     summary: Update a profile
     *     tags: ['Profiles', 'Admin']
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
     *             $ref: '#/components/schemas/ProfilePatchRequest'
     *     responses:
     *       200:
     *         description: Updated profile
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Profile' }
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Not found
     *       500:
     *         description: Profile patch failed
     */
    router.patch('/:id', adminAuth, express.json(), async (req, res) => {
        try {
            const profile = await profilesStore.patchProfile(req.params.id, req.body || {});
            if (!profile) return res.status(404).json({ error: 'not_found' });

            // Invalidate cached /get-config
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }

            // Live-apply: if settings updated, push merged settings to connected devices with this profile
            try {
                if (
                    profile &&
                    req.body &&
                    Object.prototype.hasOwnProperty.call(req.body, 'settings')
                ) {
                    const allDevices = await deviceStore.getAll();

                    for (const dev of allDevices) {
                        if (dev.profileId === profile.id && wsHub.isConnected(dev.id)) {
                            // Send the profile settings to the device
                            wsHub.sendApplySettings(dev.id, profile.settings || {});
                        }
                    }
                }
            } catch (_) {
                /* ignore live-apply errors */
            }

            res.json(profile);
        } catch (e) {
            res.status(500).json({ error: 'profile_patch_failed' });
        }
    });

    /**
     * @swagger
     * /api/profiles/{id}:
     *   delete:
     *     summary: Delete a profile
     *     description: |
     *       Deletes a profile and clears profileId from all devices that had it assigned.
     *     tags: ['Profiles', 'Admin']
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
     *         description: Deleted
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Not found
     *       500:
     *         description: Profile delete failed
     */
    router.delete('/:id', adminAuth, async (req, res) => {
        try {
            const ok = await profilesStore.deleteProfile(req.params.id);
            if (!ok) return res.status(404).json({ error: 'not_found' });

            // Clear profileId from all devices that had this profile
            try {
                const allDevices = await deviceStore.getAll();
                for (const dev of allDevices) {
                    if (dev.profileId === req.params.id) {
                        await deviceStore.update(dev.id, { profileId: null });
                    }
                }
            } catch (_) {
                /* best-effort cleanup */
            }

            // Invalidate cached /get-config
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }

            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'profile_delete_failed' });
        }
    });

    /**
     * @swagger
     * /api/profiles/{id}/command:
     *   post:
     *     summary: Broadcast a command to all devices with this profile
     *     description: Sends a command to all devices assigned to this profile.
     *     tags: ['Profiles', 'Admin']
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: wait
     *         required: false
     *         schema:
     *           type: boolean
     *           default: false
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/DeviceCommandRequest'
     *     responses:
     *       200:
     *         description: Broadcast result
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Profile not found
     *       500:
     *         description: Profile command failed
     */
    router.post('/:id/command', adminAuth, express.json(), async (req, res) => {
        try {
            const { type, payload } = req.body || {};
            if (!type) return res.status(400).json({ error: 'type_required' });

            const profile = await profilesStore.getById(req.params.id);
            if (!profile) return res.status(404).json({ error: 'not_found' });

            // Find devices with this profile
            const allDevices = await deviceStore.getAll();
            const members = allDevices.filter(d => d.profileId === profile.id);

            const wait = String(req.query.wait || '').toLowerCase() === 'true';
            let live = 0;
            let queued = 0;

            if (wait) {
                const results = [];
                await Promise.all(
                    members.map(async d => {
                        if (wsHub.isConnected(d.id)) {
                            try {
                                const ack = await wsHub
                                    .sendCommandAwait(d.id, { type, payload, timeoutMs: 3000 })
                                    .catch(err => {
                                        throw err;
                                    });
                                live++;
                                results.push({ deviceId: d.id, status: ack?.status || 'ok' });
                            } catch (e) {
                                const msg = String(e && e.message ? e.message : e);
                                if (msg === 'ack_timeout') {
                                    live++;
                                    results.push({ deviceId: d.id, status: 'timeout' });
                                } else if (msg === 'not_connected') {
                                    deviceStore.queueCommand(d.id, { type, payload });
                                    queued++;
                                    results.push({ deviceId: d.id, status: 'queued' });
                                } else {
                                    results.push({ deviceId: d.id, status: 'error', detail: msg });
                                }
                            }
                        } else {
                            deviceStore.queueCommand(d.id, { type, payload });
                            queued++;
                            results.push({ deviceId: d.id, status: 'queued' });
                        }
                    })
                );
                return res.json({ ok: true, live, queued, total: members.length, results });
            }

            // no-wait: fire-and-forget
            for (const d of members) {
                const sent = wsHub.sendCommand(d.id, { type, payload });
                if (sent) live++;
                else {
                    deviceStore.queueCommand(d.id, { type, payload });
                    queued++;
                }
            }

            res.json({ ok: true, live, queued, total: members.length });
        } catch (e) {
            res.status(500).json({ error: 'profile_command_failed' });
        }
    });

    return router;
};
