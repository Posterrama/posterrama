/**
 * Deterministic helpers to remove incidental flakiness across tests.
 * - nextId(): monotonic unique id (within process)
 * - freezeTime(ms): activates modern fake timers & sets system time
 * - advance(ms): advances fake timers & system clock
 * - withFrozenTime(fn): convenience wrapper
 */
let _counter = 0;
let _baseTime = Date.now();

function nextId(prefix = 'id') {
    return `${prefix}-${++_counter}`;
}

function ensureFakeTimers() {
    if (!jest.isMockFunction(setTimeout) || typeof setTimeout.unref === 'undefined') {
        jest.useFakeTimers();
    }
}

function freezeTime(ms = _baseTime) {
    ensureFakeTimers();
    _baseTime = ms;
    jest.setSystemTime(ms);
}

function advance(ms) {
    ensureFakeTimers();
    _baseTime += ms;
    jest.setSystemTime(_baseTime);
    jest.advanceTimersByTime(ms);
}

async function withFrozenTime(fn, start = _baseTime) {
    freezeTime(start);
    try {
        return await fn({ advance, now: () => _baseTime });
    } finally {
        jest.useRealTimers();
    }
}

module.exports = { nextId, freezeTime, advance, withFrozenTime };

// Smoke test to avoid empty suite error when this helper is treated as a test file.
describe('deterministic helpers', () => {
    test('nextId increments', () => {
        const a = nextId('t');
        const b = nextId('t');
        expect(a).not.toBe(b);
    });
});
