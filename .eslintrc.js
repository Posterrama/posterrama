module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es2022: true,
        node: true,
        jest: true,
    },
    extends: ['eslint:recommended', 'plugin:prettier/recommended'],
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    rules: {
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'no-console': 'off',
        'prefer-const': 'error',
    },
    ignorePatterns: [
        'node_modules/',
        'coverage/',
        'logs/',
        'sessions/',
        'image_cache/',
        'screenshots/',
        'temp/',
        '.env',
        '*.min.js',
        '*.html',
    ],
};
