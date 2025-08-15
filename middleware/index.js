/**
 * Middleware collection for Posterrama server optimizations
 * Centralizes all middleware for better organization and performance
 */

const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('../logger');

/**
 * Security middleware configuration
 * Implements security best practices
 */
function securityMiddleware() {
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https:", "http:"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'", "https:", "http:"]
            },
        },
        crossOriginEmbedderPolicy: false,
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    });
}

/**
 * Compression middleware for better performance
 * Compresses responses when appropriate
 */
function compressionMiddleware() {
    return compression({
        filter: (req, res) => {
            // Don't compress already compressed content or images
            if (req.headers['x-no-compression'] || 
                req.url.includes('/image/') ||
                req.url.endsWith('.jpg') || 
                req.url.endsWith('.png') ||
                req.url.endsWith('.gif') ||
                req.url.endsWith('.webp')) {
                return false;
            }
            return compression.filter(req, res);
        },
        level: 6, // Good balance between compression and CPU usage
        threshold: 1024 // Only compress if response is larger than 1KB
    });
}

/**
 * CORS middleware configuration
 * Handles cross-origin requests securely
 */
function corsMiddleware() {
    return cors({
        origin: function(origin, callback) {
            // Allow same-origin and null origin (for local file access)
            if (!origin || origin === 'null') {
                callback(null, true);
                return;
            }
            
            // Parse request origin
            try {
                const url = new URL(origin);
                // Allow localhost, same host, and dev domains
                if (url.hostname === 'localhost' || 
                    url.hostname === '127.0.0.1' ||
                    url.hostname === process.env.HOST ||
                    url.hostname.endsWith('.posterrama.app') ||
                    url.hostname === 'dev.posterrama.app') {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            } catch (err) {
                callback(new Error('Invalid origin'));
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    });
}

/**
 * Request logging middleware
 * Logs all requests with performance metrics
 */
function requestLoggingMiddleware() {
    return (req, res, next) => {
        const startTime = Date.now();
        const originalJson = res.json;
        
        // Override res.json to capture response size
        res.json = function(data) {
            const responseSize = JSON.stringify(data).length;
            res.locals.responseSize = responseSize;
            return originalJson.call(this, data);
        };

        // Log when response finishes
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logData = {
                method: req.method,
                url: req.url,
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                userAgent: req.get('User-Agent')?.substring(0, 100),
                ip: req.ip || req.connection.remoteAddress,
                responseSize: res.locals.responseSize || 0
            };

            if (res.statusCode >= 400) {
                logger.warn('Request completed with error', logData);
            } else if (duration > 5000) {
                logger.warn('Slow request detected', logData);
            } else if (req.url.includes('/api/')) {
                logger.info('API request completed', logData);
            }
        });

        next();
    };
}

/**
 * Error handling middleware
 * Centralized error handling with proper logging
 */
function errorHandlingMiddleware() {
    return (error, req, res, next) => {
        // Log the error
        const errorData = {
            error: error.message,
            stack: error.stack,
            url: req.url,
            method: req.method,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')?.substring(0, 100)
        };

        if (error.statusCode && error.statusCode < 500) {
            logger.warn('Client error occurred', errorData);
        } else {
            logger.error('Server error occurred', errorData);
        }

        // Send appropriate response
        if (res.headersSent) {
            return next(error);
        }

        const statusCode = error.statusCode || 500;
        const message = statusCode >= 500 ? 'Internal Server Error' : error.message;

        res.status(statusCode).json({
            success: false,
            error: {
                message,
                code: statusCode,
                ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
            }
        });
    };
}

/**
 * Health check middleware for monitoring
 * Provides system health information
 */
function healthCheckMiddleware() {
    return (req, res) => {
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: Math.floor(uptime),
                human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
            },
            memory: {
                rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
                external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
            },
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch
            }
        };

        res.json(health);
    };
}

module.exports = {
    securityMiddleware,
    compressionMiddleware,
    corsMiddleware,
    requestLoggingMiddleware,
    errorHandlingMiddleware,
    healthCheckMiddleware
};
