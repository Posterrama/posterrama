/**
 * Vitest setup file for frontend tests
 * Runs before each test file
 */

import { vi, beforeEach } from 'vitest';

// Mock window.location for tests that need URL manipulation
Object.defineProperty(window, 'location', {
    value: {
        href: 'http://localhost:4000',
        origin: 'http://localhost:4000',
        protocol: 'http:',
        host: 'localhost:4000',
        hostname: 'localhost',
        port: '4000',
        pathname: '/',
        search: '',
        hash: '',
        reload: vi.fn(),
        replace: vi.fn(),
    },
    writable: true,
});

// Mock localStorage
class LocalStorageMock {
    constructor() {
        this.store = {};
    }

    clear() {
        this.store = {};
    }

    getItem(key) {
        return this.store[key] || null;
    }

    setItem(key, value) {
        this.store[key] = String(value);
    }

    removeItem(key) {
        delete this.store[key];
    }

    get length() {
        return Object.keys(this.store).length;
    }

    key(index) {
        const keys = Object.keys(this.store);
        return keys[index] || null;
    }
}

global.localStorage = new LocalStorageMock();
global.sessionStorage = new LocalStorageMock();

// Mock fetch for API tests
global.fetch = vi.fn();

// Mock console methods for cleaner test output (optional)
// Uncomment if you want to suppress console output during tests
// global.console = {
//     ...console,
//     log: vi.fn(),
//     debug: vi.fn(),
//     info: vi.fn(),
//     warn: vi.fn(),
//     error: vi.fn(),
// };

// Reset mocks before each test
beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
});
