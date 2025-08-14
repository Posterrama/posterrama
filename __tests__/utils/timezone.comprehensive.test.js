// Renamed from timezone-config.test.js to timezone.comprehensive.test.js
const request = require('supertest');
const express = require('express');

describe('Timezone Configuration (comprehensive)', () => {
  let app;
  beforeEach(() => {
    global.config = {
      clockWidget: true,
      clockTimezone: 'Europe/Amsterdam',
      clockFormat: '24h',
      transitionIntervalSeconds: 15,
      backgroundRefreshMinutes: 30,
      showClearLogo: true,
      showPoster: true,
      showMetadata: true,
      showRottenTomatoes: true,
      rottenTomatoesMinimumScore: 0,
      kenBurnsEffect: { enabled: true, durationSeconds: 15 }
    };
    app = express();
    app.get('/get-config', (req, res) => {
      res.json({
        clockWidget: config.clockWidget !== false,
        clockTimezone: config.clockTimezone || 'auto',
        clockFormat: config.clockFormat || '24h',
        transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
        backgroundRefreshMinutes: config.backgroundRefreshMinutes || 30,
        showClearLogo: config.showClearLogo !== false,
        showPoster: config.showPoster !== false,
        showMetadata: config.showMetadata === true,
        showRottenTomatoes: config.showRottenTomatoes !== false,
        rottenTomatoesMinimumScore: config.rottenTomatoesMinimumScore || 0,
        kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 }
      });
    });
  });
  afterEach(() => { delete global.config; });

  test('returns default clock configuration', async () => {
    const res = await request(app).get('/get-config').expect(200);
    expect(res.body.clockFormat).toBe('24h');
  });

  test('auto timezone fallback', async () => {
    config.clockTimezone = null;
    const res = await request(app).get('/get-config').expect(200);
    expect(res.body.clockTimezone).toBe('auto');
  });

  test('supports both formats', async () => {
    config.clockFormat = '12h';
    let r = await request(app).get('/get-config').expect(200); expect(r.body.clockFormat).toBe('12h');
    config.clockFormat = '24h';
    r = await request(app).get('/get-config').expect(200); expect(r.body.clockFormat).toBe('24h');
  });
});
