const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
    // Base recommended config
    js.configs.recommended,

    // Prettier integration
    prettier,
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            'prettier/prettier': 'error',
        },
    },

    // Test files - more relaxed rules
    {
        files: ['**/__tests__/**/*.js', '**/*.test.js', '**/*.spec.js'],
        rules: {
            'no-unused-vars': 'off',
            'no-console': 'off',
        },
    },

    // Project-specific configuration
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                // Node.js globals
                console: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',

                // Browser globals
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                Response: 'readonly',
                Request: 'readonly',
                Headers: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Blob: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                FormData: 'readonly',
                Image: 'readonly',
                ImageData: 'readonly',
                Event: 'readonly',
                CustomEvent: 'readonly',
                EventTarget: 'readonly',
                WebSocket: 'readonly',
                Worker: 'readonly',
                MessageChannel: 'readonly',
                MessagePort: 'readonly',
                Intl: 'readonly',
                crypto: 'readonly',
                performance: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                atob: 'readonly',
                btoa: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                prompt: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                location: 'readonly',
                history: 'readonly',
                caches: 'readonly',
                self: 'readonly',
                MutationObserver: 'readonly',
                IntersectionObserver: 'readonly',
                getComputedStyle: 'readonly',
                CSS: 'readonly',
                Element: 'readonly',
                BroadcastChannel: 'readonly',
                structuredClone: 'readonly',
                queueMicrotask: 'readonly',
                indexedDB: 'readonly',
                HTMLSelectElement: 'readonly',
                ResizeObserver: 'readonly',
                EventSource: 'readonly',
                DataTransfer: 'readonly',

                // Jest globals
                describe: 'readonly',
                test: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly',

                // Project-specific globals
                logger: 'readonly',
                defaults: 'readonly',
                enableDebug: 'readonly',
                disableDebug: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_|^e\\d?$|^err$|^error$|Error$',
                },
            ],
            'no-console': ['warn', { allow: ['warn', 'error', 'log', 'info', 'debug', 'table'] }],
            'prefer-const': 'error',
        },
    },

    // Ignore patterns
    {
        ignores: [
            'node_modules/',
            'coverage/',
            'logs/',
            'sessions/',
            'image_cache/',
            'screenshots/',
            'temp/',
            'cache/',
            '.env*',
            '*.min.js',
            '*.html',
            'public/assets/',
            'public/vendor/',
            'dist/',
            'build/',
            'coverage/lcov-report/*.js',
            'public/libs/',
            'lighthouse-reports/',
            'docs/openapi-latest.json',
        ],
    },
];
