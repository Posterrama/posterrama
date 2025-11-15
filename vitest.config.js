import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        // Test environment
        environment: 'jsdom', // Simulates browser environment

        // Test file patterns
        include: ['__tests__/frontend/**/*.test.js', 'public/**/*.test.js'],
        exclude: ['node_modules', 'dist', '__tests__/!(frontend)/**'],

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            reportsDirectory: './coverage/frontend',
            include: ['public/**/*.js', '!public/**/*.test.js', '!public/**/test-*.js'],
            exclude: [
                'node_modules',
                'dist',
                '__tests__',
                '__mocks__',
                'coverage',
                // Exclude legacy files (not yet modularized)
                'public/admin.js',
                'public/core.js',
                'public/device-mgmt.js',
                'public/lazy-loading.js',
                'public/client-logger.js',
                'public/debug-logger.js',
            ],
            // Start with low thresholds, increase as more modules get tested
            thresholds: {
                lines: 10,
                functions: 10,
                branches: 10,
                statements: 10,
                // Per-file thresholds for new modules
                'public/error-handler.js': {
                    lines: 100,
                    functions: 100,
                    branches: 80,
                    statements: 100,
                },
            },
        },

        // Globals (optional - enables describe, it, expect without imports)
        globals: true,

        // Setup files
        setupFiles: ['__tests__/frontend/setup.js'],

        // Reporter configuration
        reporters: ['default', 'html'],
        outputFile: {
            html: './coverage/frontend/index.html',
        },

        // Test timeout
        testTimeout: 10000,

        // Mock configuration
        mockReset: true,
        clearMocks: true,
        restoreMocks: true,
    },

    // Resolve configuration for module resolution
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './public'),
            '@tests': path.resolve(__dirname, './__tests__/frontend'),
        },
    },
});
