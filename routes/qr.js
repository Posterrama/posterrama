/**
 * QR Code Generation Route
 * Provides QR code generation endpoint for admin UI
 */

const express = require('express');

/**
 * Create QR code router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Function} deps.isAuthenticated - Authentication middleware
 * @returns {express.Router} Configured router
 */
module.exports = function createQRRouter({ isAuthenticated }) {
    const router = express.Router();

    /**
     * @swagger
     * /api/qr:
     *   get:
     *     summary: Generate a QR code
     *     description: |
     *       Generates a QR code from a provided text. Returns SVG by default, or PNG if format=png.
     *
     *       **Authentication**: This endpoint allows unauthenticated access for device setup flows (e.g., pairing modal QR codes).
     *       Admin users can also access it when authenticated.
     *     tags: ['Admin']
     *     parameters:
     *       - in: query
     *         name: text
     *         schema:
     *           type: string
     *           maxLength: 2048
     *         required: true
     *         description: Text to encode in the QR code (max 2048 characters)
     *       - in: query
     *         name: format
     *         schema:
     *           type: string
     *           enum: [svg, png]
     *           default: svg
     *         required: false
     *         description: Output image format
     *     responses:
     *       200:
     *         description: QR code image
     *         content:
     *           image/svg+xml: {}
     *           image/png: {}
     *       400:
     *         description: Missing or invalid text parameter
     *       401:
     *         description: Unauthorized
     *       501:
     *         description: QR code generation not available (module missing)
     */
    router.get(
        '/api/qr',
        (req, res, next) => {
            // Allow unauthenticated access for device setup (QR codes in pairing modal)
            // But still pass through authentication for logged-in admin users
            if (req.deviceBypass || !req.isAuthenticated || req.isAuthenticated()) {
                return next();
            }
            return isAuthenticated(req, res, next);
        },
        async (req, res) => {
            try {
                const text = (req.query && req.query.text) || '';
                if (!text || typeof text !== 'string')
                    return res.status(400).json({ error: 'text_required' });
                // Limit text length to prevent QR generation errors (2953 bytes is QR code max for alphanumeric)
                if (text.length > 2953) return res.status(400).json({ error: 'text_too_long' });
                const format = String((req.query && req.query.format) || 'svg').toLowerCase();
                let QRCode;
                try {
                    QRCode = require('qrcode');
                } catch (_) {
                    return res.status(501).json({ error: 'qr_unavailable' });
                }
                if (format === 'svg') {
                    const svg = await QRCode.toString(text, {
                        type: 'svg',
                        errorCorrectionLevel: 'M',
                        margin: 1,
                        width: 256,
                    });
                    res.setHeader('Content-Type', 'image/svg+xml');
                    return res.send(svg);
                } else {
                    const dataUrl = await QRCode.toDataURL(text, {
                        errorCorrectionLevel: 'M',
                        margin: 1,
                        width: 256,
                    });
                    const b64 = (dataUrl || '').split(',')[1] || '';
                    const buf = Buffer.from(b64, 'base64');
                    res.setHeader('Content-Type', 'image/png');
                    return res.send(buf);
                }
            } catch (e) {
                res.status(500).json({ error: 'qr_render_failed' });
            }
        }
    );

    return router;
};
