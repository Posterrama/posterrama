/**
 * Cache Manager & cacheMiddleware Comprehensive Tests
 * Focus: utils/cache.js high coverage of CacheManager + cacheMiddleware flows.
 */
const express = require('express');
const request = require('supertest');
const { cacheManager, cacheMiddleware, initializeCache } = require('../../utils/cache');

// Lightweight logger spy to record messages (avoids noisy console output)
const logCalls = { debug: [], info: [], warn: [], error: [] };
const testLogger = ['debug','info','warn','error'].reduce((acc,l)=>{ acc[l] = (...a)=>logCalls[l].push(a); return acc; }, {});

initializeCache(testLogger);

describe('CacheManager core operations', () => {
  beforeEach(() => {
    // Reset internal state between tests
    cacheManager.clear();
    logCalls.debug.length = 0;
    logCalls.info.length = 0;
    logCalls.warn.length = 0;
    logCalls.error.length = 0;
    // Restore default config that tests may modify
    cacheManager.config.maxSize = 100;
    cacheManager.config.defaultTTL = 50; // small default for tests
    cacheManager.config.enablePersistence = false;
  });

  test('set/get basic flow with custom TTL and ETag', () => {
    const entry = cacheManager.set('alpha', { value: 1 }, 100);
    expect(entry).toBeTruthy();
    const got = cacheManager.get('alpha');
    expect(got.value).toEqual({ value: 1 });
    expect(got.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(got.accessCount).toBe(1);
    // Access again increments count
    cacheManager.get('alpha');
    expect(cacheManager.get('alpha').accessCount).toBe(3); // two previous gets + this one
  });

  test('size limit eviction removes oldest entry', () => {
    cacheManager.config.maxSize = 2;
    cacheManager.set('a', 'A');
    cacheManager.set('b', 'B');
    cacheManager.set('c', 'C'); // should evict 'a'
    expect(cacheManager.get('a')).toBeNull();
    expect(cacheManager.get('b')).not.toBeNull();
    expect(cacheManager.get('c')).not.toBeNull();
  });

  test('expiration removes entry after TTL', async () => {
    cacheManager.set('short', 'X', 10);
    expect(cacheManager.get('short')).not.toBeNull();
    await new Promise(r => setTimeout(r, 25));
    expect(cacheManager.get('short')).toBeNull();
  });

  test('ttl 0 causes immediate expiration and returns null entry', () => {
    const entry = cacheManager.set('immediate', 'gone', 0);
    expect(entry).toBeNull();
    expect(cacheManager.get('immediate')).toBeNull();
  });

  test('has reports validity and respects expiration', async () => {
    cacheManager.set('k', 'v', 15);
    expect(cacheManager.has('k')).toBe(true);
    await new Promise(r => setTimeout(r, 30));
    expect(cacheManager.has('k')).toBe(false);
  });

  test('clear type only removes prefixed keys', () => {
    cacheManager.set('movie:1', 1);
    cacheManager.set('movie:2', 2);
    cacheManager.set('show:1', 10);
    const removed = cacheManager.clear('movie');
    expect(removed).toBe(2);
    expect(cacheManager.get('movie:1')).toBeNull();
    expect(cacheManager.get('show:1')).not.toBeNull();
  });

  test('clear without type removes everything', () => {
    cacheManager.set('x', 1);
    cacheManager.set('y', 2);
    const removed = cacheManager.clear();
    expect(removed).toBe(2);
    expect(cacheManager.get('x')).toBeNull();
  });

  test('getStats returns structured data with hitRate', () => {
    cacheManager.set('s1', 'v1');
    cacheManager.get('s1');
    const stats = cacheManager.getStats();
    expect(stats.size).toBe(1);
    expect(stats.entries[0].accessCount).toBe(1);
    expect(stats.totalAccess).toBe(1);
    expect(stats.hitRate).toBeGreaterThanOrEqual(1);
  });

  test('set handles serialization error (circular object) gracefully', () => {
    const circular = {}; circular.self = circular; // JSON.stringify will throw
    const entry = cacheManager.set('circ', circular);
    expect(entry).toBeNull();
    // An error log should have been recorded
    expect(logCalls.error.length).toBeGreaterThan(0);
  });

  test('persistence write failure logs warning without crashing', async () => {
    cacheManager.config.enablePersistence = true;
    // Spy on fs.writeFile to throw
    const fs = require('fs');
    const spy = jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));
    cacheManager.set('persist', { a: 1 }, 100);
    // allow microtasks
    await new Promise(r => setTimeout(r, 5));
    expect(logCalls.warn.find(args => String(args[0]||'').includes('Failed to persist cache entry'))).toBeTruthy();
    spy.mockRestore();
  });
});

describe('cacheMiddleware integration', () => {
  let app;
  beforeEach(() => {
    cacheManager.clear();
    app = express();
    app.use(cacheMiddleware({ ttl: 50 }));
    app.get('/hello', (req, res) => {
      res.json({ msg: 'world', t: Date.now() });
    });
  });

  test('first request MISS then HIT with ETag handling', async () => {
    const first = await request(app).get('/hello').expect(200);
    expect(first.headers['x-cache']).toBe('MISS');
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

  const second = await request(app).get('/hello').expect(200);
  expect(second.headers['x-cache']).toBe('HIT');
  // Body may already be parsed (json) or string depending on send path
  const body = typeof second.body === 'object' && Object.keys(second.body).length ? second.body : JSON.parse(second.text);
  expect(body.msg).toBe('world');

    // Conditional request should 304
    await request(app)
      .get('/hello')
      .set('If-None-Match', etag)
      .expect(304);
  });

  test('skips caching for non-GET and no-cache header', async () => {
    // POST should bypass cache
    app.post('/hello', (req, res) => res.send('posted'));
    await request(app).post('/hello').expect(200);
    // no-cache header bypass
    await request(app).get('/hello').set('Cache-Control', 'no-cache').expect(200);
  });
});
