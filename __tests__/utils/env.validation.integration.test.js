// Renamed from validate-env.test.js to env.validation.integration.test.js
const fs = require('fs');

describe('Environment Validator integration', () => {
  let originalProcessExit, originalConsoleError, originalConsoleWarn, originalFsReadFileSync;
  let mockExit, mockConsoleError, mockConsoleWarn;
  beforeEach(() => {
    originalProcessExit = process.exit; originalConsoleError = console.error; originalConsoleWarn = console.warn; originalFsReadFileSync = fs.readFileSync;
    mockExit = jest.fn(code => { if (code === 1) throw new Error('Process exit with code 1'); });
    mockConsoleError = jest.fn(); mockConsoleWarn = jest.fn();
    process.exit = mockExit; console.error = mockConsoleError; console.warn = mockConsoleWarn; jest.resetModules();
    delete process.env.PLEX_HOSTNAME; delete process.env.PLEX_PORT; delete process.env.PLEX_TOKEN;
  });
  afterEach(() => { process.exit = originalProcessExit; console.error = originalConsoleError; console.warn = originalConsoleWarn; fs.readFileSync = originalFsReadFileSync; });
  const validConfig = { transitionIntervalSeconds:15, backgroundRefreshMinutes:30, showClearLogo:true, showRottenTomatoes:true, rottenTomatoesMinimumScore:0, showPoster:true, showMetadata:true, clockWidget:false, transitionEffect:'none', effectPauseTime:0, kenBurnsEffect:{ enabled:true, durationSeconds:15 }, mediaServers:[{ name:'Test Server', type:'plex', enabled:true, hostnameEnvVar:'PLEX_HOSTNAME', portEnvVar:'PLEX_PORT', tokenEnvVar:'PLEX_TOKEN' }] };
  test('valid config', () => { fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(validConfig)); process.env.PLEX_HOSTNAME='localhost'; process.env.PLEX_PORT='32400'; process.env.PLEX_TOKEN='tok'; try { delete require.cache[require.resolve('../../validate-env')]; require('../../validate-env'); expect(mockExit).not.toHaveBeenCalledWith(1); } catch(e){ if(e.message!=='Process exit with code 1') throw e; } });
  test('file read error', () => { fs.readFileSync = jest.fn(()=>{ throw new Error('File not found'); }); try { delete require.cache[require.resolve('../../validate-env')]; require('../../validate-env.js'); } catch(_){} expect(mockExit).toHaveBeenCalledWith(1); });
});
