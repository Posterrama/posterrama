/**
 * Tests for UserAgentBuilder (Issue #7)
 *
 * Validates centralized User-Agent construction for consistent
 * HTTP client identification across all external API clients.
 */

const UserAgentBuilder = require('../../utils/userAgent');
const os = require('os');
const pkg = require('../../package.json');

describe('UserAgentBuilder (Issue #7)', () => {
    describe('build()', () => {
        it('should build basic User-Agent with defaults', () => {
            const ua = UserAgentBuilder.build();

            expect(ua).toContain(`Posterrama/${pkg.version}`);
            expect(ua).toContain(`Node.js/${process.version}`);
            expect(ua).toContain(os.platform());
            expect(ua).toContain(os.release());
        });

        it('should include service identifier', () => {
            const ua = UserAgentBuilder.build('Test-Service');

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(Test-Service)');
        });

        it('should not include service for default', () => {
            const ua = UserAgentBuilder.build('default');

            expect(ua).toContain('Posterrama/');
            expect(ua).not.toContain('(default)');
        });

        it('should include hostname when requested', () => {
            const ua = UserAgentBuilder.build('Service', { includeHostname: true });

            expect(ua).toContain(`Host/${os.hostname()}`);
        });

        it('should exclude hostname by default', () => {
            const ua = UserAgentBuilder.build('Service');

            expect(ua).not.toContain('Host/');
        });

        it('should exclude Node.js version when requested', () => {
            const ua = UserAgentBuilder.build('Service', { includeNodeVersion: false });

            expect(ua).toContain('Posterrama/');
            expect(ua).not.toContain('Node.js/');
        });

        it('should exclude OS info when requested', () => {
            const ua = UserAgentBuilder.build('Service', { includeOS: false });

            expect(ua).toContain('Posterrama/');
            expect(ua).not.toContain(os.platform());
            expect(ua).not.toContain(os.release());
        });

        it('should handle all options disabled', () => {
            const ua = UserAgentBuilder.build('Service', {
                includeHostname: false,
                includeNodeVersion: false,
                includeOS: false,
            });

            expect(ua).toBe(`Posterrama/${pkg.version} (Service)`);
        });

        it('should handle all options enabled', () => {
            const ua = UserAgentBuilder.build('Service', {
                includeHostname: true,
                includeNodeVersion: true,
                includeOS: true,
            });

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(Service)');
            expect(ua).toContain('Node.js/');
            expect(ua).toContain(os.platform());
            expect(ua).toContain(`Host/${os.hostname()}`);
        });
    });

    describe('forPlex()', () => {
        it('should build Plex-specific User-Agent', () => {
            const ua = UserAgentBuilder.forPlex();

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(Plex-Client)');
            expect(ua).toContain('Node.js/');
            expect(ua).toContain(os.platform());
            expect(ua).toContain(`Host/${os.hostname()}`);
        });

        it('should include hostname for Plex', () => {
            const ua = UserAgentBuilder.forPlex();

            expect(ua).toContain('Host/');
        });

        it('should have consistent format', () => {
            const ua = UserAgentBuilder.forPlex();
            const parts = ua.split(' ');

            expect(parts[0]).toMatch(/^Posterrama\/\d+\.\d+\.\d+/);
            expect(parts[1]).toBe('(Plex-Client)');
        });
    });

    describe('forJellyfin()', () => {
        it('should build Jellyfin-specific User-Agent', () => {
            const ua = UserAgentBuilder.forJellyfin();

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(Jellyfin-Client)');
            expect(ua).toContain('Node.js/');
            expect(ua).toContain(os.platform());
            expect(ua).toContain(`Host/${os.hostname()}`);
        });

        it('should include hostname for Jellyfin', () => {
            const ua = UserAgentBuilder.forJellyfin();

            expect(ua).toContain('Host/');
        });

        it('should differ from Plex User-Agent', () => {
            const plexUA = UserAgentBuilder.forPlex();
            const jellyfinUA = UserAgentBuilder.forJellyfin();

            expect(plexUA).not.toBe(jellyfinUA);
            expect(plexUA).toContain('Plex-Client');
            expect(jellyfinUA).toContain('Jellyfin-Client');
        });
    });

    describe('forTMDB()', () => {
        it('should build TMDB-specific User-Agent', () => {
            const ua = UserAgentBuilder.forTMDB();

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(TMDB-Client)');
            expect(ua).toContain('Node.js/');
            expect(ua).toContain(os.platform());
        });

        it('should NOT include hostname for public API', () => {
            const ua = UserAgentBuilder.forTMDB();

            expect(ua).not.toContain('Host/');
        });

        it('should be shorter than internal service UAs', () => {
            const tmdbUA = UserAgentBuilder.forTMDB();
            const jellyfinUA = UserAgentBuilder.forJellyfin();

            expect(tmdbUA.length).toBeLessThan(jellyfinUA.length);
        });
    });

    describe('forRomM()', () => {
        it('should build RomM-specific User-Agent', () => {
            const ua = UserAgentBuilder.forRomM();

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('(RomM-Client)');
            expect(ua).toContain('Node.js/');
            expect(ua).toContain(os.platform());
            expect(ua).toContain(`Host/${os.hostname()}`);
        });

        it('should include hostname for RomM', () => {
            const ua = UserAgentBuilder.forRomM();

            expect(ua).toContain('Host/');
        });
    });

    describe('minimal()', () => {
        it('should return minimal User-Agent', () => {
            const ua = UserAgentBuilder.minimal();

            expect(ua).toBe(`Posterrama/${pkg.version}`);
        });

        it('should not include any additional info', () => {
            const ua = UserAgentBuilder.minimal();

            expect(ua).not.toContain('Node.js');
            expect(ua).not.toContain('Host/');
            expect(ua).not.toContain(os.platform());
            expect(ua.split(' ')).toHaveLength(1);
        });

        it('should be shortest possible User-Agent', () => {
            const minimal = UserAgentBuilder.minimal();
            const full = UserAgentBuilder.build();

            expect(minimal.length).toBeLessThan(full.length);
        });
    });

    describe('getVersion()', () => {
        it('should return package version', () => {
            const version = UserAgentBuilder.getVersion();

            expect(version).toBe(pkg.version);
        });

        it('should return valid semver format', () => {
            const version = UserAgentBuilder.getVersion();

            expect(version).toMatch(/^\d+\.\d+\.\d+/);
        });
    });

    describe('consistency', () => {
        it('should produce consistent output for same inputs', () => {
            const ua1 = UserAgentBuilder.forJellyfin();
            const ua2 = UserAgentBuilder.forJellyfin();

            expect(ua1).toBe(ua2);
        });

        it('should have consistent part ordering', () => {
            const ua = UserAgentBuilder.build('Service', {
                includeHostname: true,
                includeNodeVersion: true,
                includeOS: true,
            });

            const parts = ua.split(' ');

            // Order: Posterrama/X.X.X (Service) Node.js/X platform/release Host/hostname
            expect(parts[0]).toMatch(/^Posterrama\/\d/);
            expect(parts[1]).toMatch(/^\([^)]+\)$/);
            expect(parts[2]).toMatch(/^Node\.js\//);
            expect(parts[3]).toMatch(/\//); // platform/release
            expect(parts[4]).toMatch(/^Host\//);
        });

        it('should use space as separator consistently', () => {
            const ua = UserAgentBuilder.forJellyfin();

            expect(ua).not.toContain('  '); // No double spaces
            expect(ua.split(' ').every(part => part.length > 0)).toBe(true);
        });
    });

    describe('service identifiers', () => {
        it('should use unique identifiers for each service', () => {
            const services = [
                UserAgentBuilder.forPlex(),
                UserAgentBuilder.forJellyfin(),
                UserAgentBuilder.forTMDB(),
                UserAgentBuilder.forRomM(),
            ];

            const identifiers = services.map(ua => {
                const match = ua.match(/\(([^)]+)\)/);
                return match ? match[1] : null;
            });

            // All should be unique
            const uniqueIdentifiers = new Set(identifiers);
            expect(uniqueIdentifiers.size).toBe(services.length);
        });

        it('should use -Client suffix consistently', () => {
            const services = [
                UserAgentBuilder.forPlex(),
                UserAgentBuilder.forJellyfin(),
                UserAgentBuilder.forTMDB(),
                UserAgentBuilder.forRomM(),
            ];

            services.forEach(ua => {
                expect(ua).toMatch(/\([^)]+Client\)/);
            });
        });
    });

    describe('edge cases', () => {
        it('should handle empty service name gracefully', () => {
            const ua = UserAgentBuilder.build('');

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('Node.js/');
        });

        it('should handle special characters in service name', () => {
            const ua = UserAgentBuilder.build('Test-Service/v2.0');

            expect(ua).toContain('(Test-Service/v2.0)');
        });

        it('should handle null options', () => {
            const ua = UserAgentBuilder.build('Service', null);

            expect(ua).toContain('Posterrama/');
        });

        it('should handle undefined options', () => {
            const ua = UserAgentBuilder.build('Service', undefined);

            expect(ua).toContain('Posterrama/');
        });

        it('should handle empty options object', () => {
            const ua = UserAgentBuilder.build('Service', {});

            expect(ua).toContain('Posterrama/');
            expect(ua).toContain('Node.js/'); // Defaults apply
        });
    });

    describe('format compliance', () => {
        it('should follow HTTP User-Agent format standards', () => {
            const ua = UserAgentBuilder.forJellyfin();

            // Should not contain invalid characters
            expect(ua).not.toMatch(/[\r\n]/);
            expect(ua).not.toMatch(/[^\x20-\x7E]/); // Only printable ASCII
        });

        it('should not exceed reasonable length', () => {
            const ua = UserAgentBuilder.build('VeryLongServiceNameForTesting', {
                includeHostname: true,
                includeNodeVersion: true,
                includeOS: true,
            });

            // Most servers accept up to 255 characters
            expect(ua.length).toBeLessThan(255);
        });

        it('should be valid for HTTP headers', () => {
            const ua = UserAgentBuilder.forJellyfin();

            // Should be a single line without control characters
            expect(ua.split('\n')).toHaveLength(1);
            // eslint-disable-next-line no-control-regex
            expect(ua).not.toMatch(/[\x00-\x1F\x7F]/);
        });
    });
});
