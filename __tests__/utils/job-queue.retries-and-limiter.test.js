// Note: Removed unused 'path' and 'fs' imports to satisfy ESLint

// Ensure test mode for validators/loggers
process.env.NODE_ENV = 'test';

const JobQueue = require('../../utils/job-queue');

describe('JobQueue download retry/backoff and global limiter', () => {
    test('downloadAsset retries on 429/5xx and transient codes, then succeeds', async () => {
        const jq = new JobQueue({ localDirectory: { posterpackGeneration: {} } });
        // Fake http client with 2 failures (429) then success
        let calls = 0;
        jq.httpClients = {
            plex: {
                async get() {
                    calls++;
                    if (calls <= 2) {
                        const err = new Error('rate limited');
                        err.response = { status: 429 };
                        throw err;
                    }
                    return { status: 200, data: Buffer.from('ok') };
                },
            },
        };

        const buf = await jq.downloadAsset('/image?x=1', 'plex');
        expect(buf).toBeInstanceOf(Buffer);
        expect(String(buf)).toBe('ok');
        expect(calls).toBeGreaterThanOrEqual(3);
    });

    test('global inflight limiter caps parallelism', async () => {
        const jq = new JobQueue({
            localDirectory: { posterpackGeneration: { maxInflightDownloads: 2 } },
        });
        let concurrent = 0;
        let peak = 0;
        jq.httpClients = {
            jellyfin: {
                async get() {
                    concurrent++;
                    peak = Math.max(peak, concurrent);
                    await new Promise(r => setTimeout(r, 20));
                    concurrent--;
                    return { status: 200, data: Buffer.from('x') };
                },
            },
        };

        const N = 8;
        await Promise.all(
            new Array(N)
                .fill(0)
                .map(() => jq._withInflightLimit(() => jq.downloadAsset('/image?a=1', 'jellyfin')))
        );
        expect(peak).toBeLessThanOrEqual(2);
    });
});
