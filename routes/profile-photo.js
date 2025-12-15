/**
 * Profile Photo Routes
 * Handles user avatar upload, retrieval, and deletion
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;

/**
 * @typedef {Object} SessionData
 * @property {Object} [user] - Authenticated user
 */

/**
 * @typedef {Object} ProfileRequestExtensions
 * @property {SessionData} [session] - Express session
 */

/**
 * @typedef {import('express').Request & ProfileRequestExtensions} ProfileRequest
 */

/**
 * Create profile photo router
 * @param {Object} deps - Dependencies
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @param {Function} deps.getAvatarPath - Get avatar file path helper
 * @param {string} deps.avatarDir - Avatar storage directory path
 * @returns {express.Router} Configured router
 */
module.exports = function createProfilePhotoRouter({ adminAuth, getAvatarPath, avatarDir }) {
    const router = express.Router();

    // Configure multer for small avatar uploads (PNG/JPEG/WebP; 2MB limit)
    const avatarStorage = multer.diskStorage({
        destination: function (_req, _file, cb) {
            fs.mkdir(avatarDir, { recursive: true }, () => cb(null, avatarDir));
        },
        filename: function (req, file, cb) {
            // Use a deterministic filename per user (session username) to keep one file
            const username = (req.session?.user?.username || 'admin').replace(
                /[^a-z0-9_-]+/gi,
                '_'
            );
            const ext =
                file.mimetype === 'image/png'
                    ? '.png'
                    : file.mimetype === 'image/webp'
                      ? '.webp'
                      : '.jpg';
            cb(null, `${username}${ext}`);
        },
    });

    const avatarUpload = multer({
        storage: avatarStorage,
        limits: { fileSize: 2 * 1024 * 1024 },
        fileFilter: function (_req, file, cb) {
            const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
            if (!ok) return cb(new Error('Unsupported file type'));
            cb(null, true);
        },
    });

    /**
     * @swagger
     * /api/admin/profile/photo:
     *   get:
     *     summary: Get current user's profile photo
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Image file
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     *           image/jpeg:
     *             schema:
     *               type: string
     *               format: binary
     *           image/webp:
     *             schema:
     *               type: string
     *               format: binary
     *       204:
     *         description: No avatar set
     */
    // @ts-ignore - Express router overload issue
    router.get('/api/admin/profile/photo', adminAuth, (/** @type {ProfileRequest} */ req, res) => {
        const username = req.session?.user?.username || 'admin';
        const p = getAvatarPath(username, avatarDir);
        if (!p) return res.status(204).end();
        res.sendFile(p);
    });

    /**
     * @swagger
     * /api/admin/profile/photo:
     *   post:
     *     summary: Upload/update current user's profile photo
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             properties:
     *               avatar:
     *                 type: string
     *                 format: binary
     *                 description: Image file (PNG/JPEG/WebP, max 2MB)
     *     responses:
     *       200:
     *         description: Upload successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *       400:
     *         description: Invalid input or unsupported file type
     */
    // @ts-ignore - Express router overload issue
    router.post('/api/admin/profile/photo', adminAuth, (req, res, _next) => {
        avatarUpload.single('avatar')(req, res, err => {
            if (err) {
                return res.status(400).json({ error: err.message || 'Upload failed' });
            }
            res.json({ success: true });
        });
    });

    /**
     * @swagger
     * /api/admin/profile/photo:
     *   delete:
     *     summary: Remove current user's profile photo
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *       500:
     *         description: Failed to delete avatar
     */
    router.delete(
        '/api/admin/profile/photo',
        // @ts-ignore - Express router overload issue
        adminAuth,
        async (/** @type {ProfileRequest} */ req, res) => {
            try {
                const username = req.session?.user?.username || 'admin';
                const p = getAvatarPath(username, avatarDir);
                if (p) await fsp.unlink(p).catch(() => {});
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Failed to delete avatar' });
            }
        }
    );

    return router;
};
