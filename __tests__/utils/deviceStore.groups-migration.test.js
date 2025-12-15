const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Verifies the device store scrubs legacy device.groups fields on read.
 * This ensures old persisted devices.json data doesn't carry dead fields.
 */

describe('DeviceStore legacy groups migration', () => {
    const originalDevicesStorePath = process.env.DEVICES_STORE_PATH;

    afterEach(() => {
        if (originalDevicesStorePath === undefined) {
            delete process.env.DEVICES_STORE_PATH;
        } else {
            process.env.DEVICES_STORE_PATH = originalDevicesStorePath;
        }
        jest.resetModules();
    });

    test('removes groups from loaded devices and persists the scrubbed store', async () => {
        const tmpFile = path.join(
            os.tmpdir(),
            `posterrama-devices-${Date.now()}-${process.pid}.json`
        );

        fs.writeFileSync(
            tmpFile,
            JSON.stringify(
                [
                    { id: 'd1', name: 'Device 1', groups: ['a', 'b'] },
                    { id: 'd2', name: 'Device 2', groups: [] },
                ],
                null,
                2
            )
        );

        process.env.DEVICES_STORE_PATH = tmpFile;

        // Ensure module picks up the DEVICES_STORE_PATH
        jest.resetModules();
        const deviceStore = require('../../utils/deviceStore');

        const devices = await deviceStore.getAll();
        expect(devices).toHaveLength(2);
        expect(devices[0]).not.toHaveProperty('groups');
        expect(devices[1]).not.toHaveProperty('groups');

        const persisted = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        expect(persisted[0]).not.toHaveProperty('groups');
        expect(persisted[1]).not.toHaveProperty('groups');

        try {
            fs.unlinkSync(tmpFile);
        } catch (_) {
            /* ignore */
        }
    });
});
