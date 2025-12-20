process.env.NODE_ENV = 'test';

describe('RomM platform itemId expansion', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('builds romm_<server>_<id> keys across pages', async () => {
        const getRoms = jest
            .fn()
            .mockResolvedValueOnce({
                total: 3,
                items: [{ id: 101 }, { id: 102 }],
            })
            .mockResolvedValueOnce({
                total: 3,
                items: [{ id: 103 }],
            });

        jest.doMock('../../sources/romm', () => {
            return function RommSourceMock(_serverConfig) {
                this.getClient = async () => ({ getRoms });
            };
        });

        const { getRommPlatformItemIds } = require('../../utils/romm-platform-item-ids');

        const res = await getRommPlatformItemIds({
            config: {
                mediaServers: [
                    { type: 'romm', enabled: true, name: 'MainRomM' },
                    { type: 'plex', enabled: true, name: 'Plex' },
                ],
            },
            logger: { warn: jest.fn() },
            platformId: 'n64',
            maxItems: 100,
            pageSize: 2,
        });

        expect(getRoms).toHaveBeenCalledTimes(2);
        expect(getRoms.mock.calls[0][0]).toMatchObject({ platform_id: 'n64', limit: 2, offset: 0 });
        expect(getRoms.mock.calls[1][0]).toMatchObject({ platform_id: 'n64', limit: 2, offset: 2 });

        expect(res.itemIds).toEqual([
            'romm_MainRomM_101',
            'romm_MainRomM_102',
            'romm_MainRomM_103',
        ]);
        expect(res.totalFound).toBe(3);
        expect(res.capped).toBe(false);
    });

    test('caps results when maxItems reached', async () => {
        const getRoms = jest.fn().mockResolvedValue({
            total: 999,
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        });

        jest.doMock('../../sources/romm', () => {
            return function RommSourceMock() {
                this.getClient = async () => ({ getRoms });
            };
        });

        const { getRommPlatformItemIds } = require('../../utils/romm-platform-item-ids');

        const res = await getRommPlatformItemIds({
            config: { mediaServers: [{ type: 'romm', enabled: true, name: 'S' }] },
            logger: { warn: jest.fn() },
            platformId: 'switch',
            maxItems: 2,
            pageSize: 50,
        });

        expect(res.itemIds).toEqual(['romm_S_1', 'romm_S_2']);
        expect(res.capped).toBe(true);
    });

    test('applies yearFilter when provided', async () => {
        const getRoms = jest.fn().mockResolvedValue({
            total: 3,
            items: [
                { id: 1, metadatum: { first_release_date: 915148800 } }, // 1999-01-01 (epoch seconds)
                { id: 2, metadatum: { first_release_date: 946684800 } }, // 2000-01-01
                { id: 3, metadatum: { first_release_date: 978307200000 } }, // 2001-01-01 (epoch ms)
            ],
        });

        jest.doMock('../../sources/romm', () => {
            return function RommSourceMock() {
                this.getClient = async () => ({ getRoms });
            };
        });

        const { getRommPlatformItemIds } = require('../../utils/romm-platform-item-ids');

        const res = await getRommPlatformItemIds({
            config: { mediaServers: [{ type: 'romm', enabled: true, name: 'S' }] },
            logger: { warn: jest.fn() },
            platformId: 'ps1',
            yearFilter: '2000-2001',
            maxItems: 100,
            pageSize: 50,
        });

        expect(res.itemIds).toEqual(['romm_S_2', 'romm_S_3']);
    });
});
