/**
 * Groups Management Routes
 *
 * Handles device group CRUD operations and group command broadcasting.
 * Groups allow organizing devices with shared settings templates and batch operations.
 *
 * @module routes/groups
 */

const express = require('express');
const router = express.Router();
const groupsStore = require('../utils/groupsStore');
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
module.exports = function createGroupsRouter({ adminAuth, cacheManager }) {
    /**
     * @swagger
     * /api/groups:
     *   get:
     *     summary: List all groups
     *     description: |
     *       Returns all device groups with their settings templates and members.
     *
     *       **Note**: Pagination is not yet implemented. All groups are returned in a single response.
     *     tags: ['Groups', 'Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Groups array
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items: { $ref: '#/components/schemas/Group' }
     *             example:
     *               - id: lobby-displays
     *                 name: Lobby Displays
     *                 description: All screens in the main lobby
     *                 settingsTemplate: { transitionIntervalSeconds: 30 }
     *                 order: 1
     *               - id: bedroom-displays
     *                 name: Bedroom Displays
     *                 description: Bedroom screens with night mode
     *                 settingsTemplate: { clockWidget: false }
     *                 order: 2
     *       401:
     *         description: Unauthorized
     *       500:
     *         description: Groups list failed
     */
    // @ts-ignore - Express router overload issue
    router.get('/', adminAuth, async (_req, res) => {
        try {
            const list = await groupsStore.getAll();
            res.json(list);
        } catch (e) {
            res.status(500).json({ error: 'groups_list_failed' });
        }
    });

    /**
     * @swagger
     * /api/groups:
     *   post:
     *     summary: Create a group
     *     tags: ['Groups', 'Admin']
     *     security:
     *       - sessionAuth: []
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'Create Basic Group'
     *         source: |
     *           curl -X POST http://localhost:4000/api/groups \
     *             -H "Content-Type: application/json" \
     *             -H "Cookie: connect.sid=your-session" \
     *             -d '{
     *               "id": "lobby-displays",
     *               "name": "Lobby Displays",
     *               "description": "All screens in the main lobby"
     *             }'
     *       - lang: 'JavaScript'
     *         label: 'Create Group with Settings Template'
     *         source: |
     *           fetch('http://localhost:4000/api/groups', {
     *             method: 'POST',
     *             headers: { 'Content-Type': 'application/json' },
     *             credentials: 'include',
     *             body: JSON.stringify({
     *               id: 'kitchen-displays',
     *               name: 'Kitchen Displays',
     *               description: 'Kitchen area screens',
     *               settingsTemplate: {
     *                 screensaverInterval: 8000,
     *                 transitionDuration: 1500
     *               },
     *               order: 10
     *             })
     *           });
     *       - lang: 'Python'
     *         label: 'Create Group with Python'
     *         source: |
     *           import requests
     *           session = requests.Session()
     *           session.post('http://localhost:4000/admin/login',
     *                        data={'username': 'admin', 'password': 'pass'})
     *           response = session.post('http://localhost:4000/api/groups',
     *             json={
     *               'id': 'conference-rooms',
     *               'name': 'Conference Rooms',
     *               'description': 'All conference room displays',
     *               'settingsTemplate': {
     *                 'randomOrder': False,
     *                 'showMetadata': True
     *               }
     *             })
     *           print(f"Created group: {response.json()['name']}")
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/GroupCreateRequest'
     *           examples:
     *             basic:
     *               summary: Basic group
     *               value:
     *                 id: lobby-displays
     *                 name: Lobby Displays
     *                 description: All screens in the main lobby
     *             with_settings:
     *               summary: Group with settings template
     *               value:
     *                 id: kitchen-displays
     *                 name: Kitchen Displays
     *                 description: Kitchen area screens
     *                 settingsTemplate:
     *                   screensaverInterval: 8000
     *                   transitionDuration: 1500
     *                   randomOrder: true
     *                 order: 10
     *     responses:
     *       201:
     *         description: Created group
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Group' }
     *       401:
     *         description: Unauthorized
     *       409:
     *         description: Group exists
     *       500:
     *         description: Group create failed
     */
    // @ts-ignore - Express router overload issue
    router.post('/', adminAuth, express.json(), async (req, res) => {
        try {
            const { id, name, description, settingsTemplate, order } = req.body || {};
            const g = await groupsStore.createGroup(
                /** @type {any} */ ({
                    id,
                    name,
                    description,
                    settingsTemplate,
                    order,
                })
            );
            // Invalidate cached /get-config so group templates take effect
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }
            res.status(201).json(g);
        } catch (e) {
            if (e && e.message === 'group_exists')
                return res.status(409).json({ error: 'group_exists' });
            res.status(500).json({ error: 'group_create_failed' });
        }
    });

    /**
     * @swagger
     * /api/groups/{id}:
     *   patch:
     *     summary: Patch a group
     *     tags: ['Groups', 'Admin']
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
     *             $ref: '#/components/schemas/GroupPatchRequest'
     *     responses:
     *       200:
     *         description: Updated group
     *         content:
     *           application/json:
     *             schema: { $ref: '#/components/schemas/Group' }
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Not found
     *       500:
     *         description: Group patch failed
     */
    // @ts-ignore - Express router overload issue
    router.patch('/:id', adminAuth, express.json(), async (req, res) => {
        try {
            const g = await groupsStore.patchGroup(req.params.id, req.body || {});
            if (!g) return res.status(404).json({ error: 'not_found' });
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }
            // Best-effort live-apply: if settingsTemplate updated, push merged templates to connected members
            try {
                if (
                    g &&
                    req.body &&
                    Object.prototype.hasOwnProperty.call(req.body, 'settingsTemplate')
                ) {
                    const allDevices = await deviceStore.getAll();
                    const allGroups = await groupsStore.getAll();
                    for (const dev of allDevices) {
                        if (
                            Array.isArray(dev.groups) &&
                            dev.groups.includes(g.id) &&
                            wsHub.isConnected(dev.id)
                        ) {
                            // Build deterministic group sequence: order asc, then device index
                            const seq = dev.groups
                                .map((gid, idx) => {
                                    const gx = allGroups.find(x => x.id === gid);
                                    return gx ? { g: gx, idx } : null;
                                })
                                .filter(Boolean)
                                .sort((a, b) => {
                                    const ao = Number.isFinite(a.g.order)
                                        ? a.g.order
                                        : Number.MAX_SAFE_INTEGER;
                                    const bo = Number.isFinite(b.g.order)
                                        ? b.g.order
                                        : Number.MAX_SAFE_INTEGER;
                                    if (ao !== bo) return ao - bo;
                                    return a.idx - b.idx;
                                });
                            let mergedTemplate = {};
                            for (const { g: gg } of seq) {
                                if (
                                    gg &&
                                    gg.settingsTemplate &&
                                    typeof gg.settingsTemplate === 'object'
                                ) {
                                    mergedTemplate = deepMerge(
                                        {},
                                        mergedTemplate,
                                        gg.settingsTemplate
                                    );
                                }
                            }
                            wsHub.sendApplySettings(dev.id, mergedTemplate);
                        }
                    }
                }
            } catch (_) {
                /* ignore live-apply errors */
            }
            res.json(g);
        } catch (e) {
            res.status(500).json({ error: 'group_patch_failed' });
        }
    });

    /**
     * @swagger
     * /api/groups/{id}:
     *   delete:
     *     summary: Delete a group
     *     tags: ['Groups', 'Admin']
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
     *         description: Group delete failed
     */
    // @ts-ignore - Express router overload issue
    router.delete('/:id', adminAuth, async (req, res) => {
        try {
            const ok = await groupsStore.deleteGroup(req.params.id);
            if (!ok) return res.status(404).json({ error: 'not_found' });
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('GET:/get-config');
                }
            } catch (_) {
                /* no-op: cache clear is best-effort */
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'group_delete_failed' });
        }
    });

    /**
     * @swagger
     * /api/groups/{id}/command:
     *   post:
     *     summary: Broadcast a command to group members
     *     description: Sends a command to all devices in the group. Use wait=true to collect per-device ACKs.
     *     tags: ['Groups', 'Admin']
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/GroupCommandResponse'
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Group not found
     *       500:
     *         description: Group command failed
     */
    // @ts-ignore - Express router overload issue
    router.post('/:id/command', adminAuth, express.json(), async (req, res) => {
        try {
            const { type, payload } = req.body || {};
            if (!type) return res.status(400).json({ error: 'type_required' });
            const g = await groupsStore.getById(req.params.id);
            if (!g) return res.status(404).json({ error: 'not_found' });
            // Find devices that belong to this group
            const all = await deviceStore.getAll();
            const members = all.filter(d => Array.isArray(d.groups) && d.groups.includes(g.id));
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
            // no-wait: fire-and-forget like before
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
            res.status(500).json({ error: 'group_command_failed' });
        }
    });

    return router;
};
