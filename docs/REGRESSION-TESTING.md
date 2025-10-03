# Comprehensive Regression Testing Suite

## Overzicht

Dit implementeert een complete regressie testing framework voor Posterrama om het "2 steps forward, 1 step back" probleem op te lossen door automatisch breaking changes te detecteren.

## Geïmplementeerde Regression Tests

### 1. API Contract Validation (`api-contract-validation.test.js`)

**Doel:** Voorkomt API breaking changes

- ✅ Detecteert wijzigingen in response structuren
- ✅ Valideert HTTP status codes
- ✅ Performance baselines voor API calls
- ✅ Automatische baseline storage en vergelijking

### 2. Critical Path E2E Tests (`critical-path.e2e.test.js`)

**Doel:** Test core gebruikersworkflows end-to-end

- ✅ Media display workflows
- ✅ Admin configuratie flows
- ✅ Device pairing en WebSocket communicatie
- ✅ Health monitoring en metrics

### 3. Config Migration Tests (`config-migration.test.js`)

**Doel:** Valideert config schema wijzigingen en backward compatibility

- ✅ AJV schema validation
- ✅ Migration path testing
- ✅ Backward compatibility checking
- ✅ Performance regression voor config operations

### 4. External Service Integration Tests (`external-services.test.js`)

**Doel:** Test Plex/Jellyfin/TMDB integraties zonder echte API calls

- ✅ Nock-based service mocking
- ✅ Contract validation per service
- ✅ Error handling en resilience testing
- ✅ Rate limiting en timeout scenarios

### 5. Visual Regression Tests (`visual-regression.test.js`)

**Doel:** Detecteert UI breaking changes via screenshots

- ✅ Puppeteer-based screenshot capture
- ✅ Pixelmatch voor visuele vergelijkingen
- ✅ Responsive design testing (desktop/mobile)
- ✅ HTML report generatie met diff images

## Automatische Integratie

### Release Check Script

- **FASE 1**: API contracts en config schema tests zijn **BLOCKING**
- **FASE 1**: External services en E2E tests zijn **WARNING** (niet-blocking)
- Performance baselines worden gemonitord

### GitHub Actions Workflow

- Dagelijke regressie tests (2:00 UTC)
- PR validation met alle regression tests
- Multi-Node.js versie testing (18.x, 20.x)
- Automatische issue creation bij failures

### Package.json Scripts

```bash
npm run test:regression                    # Alle regression tests
npm run test:regression:contracts         # API contract tests
npm run test:regression:config           # Config migration tests
npm run test:regression:external         # External service tests
npm run test:regression:visual           # Visual regression tests
npm run test:full-regression            # Contracts + config + external (core suite)
```

## Installatie & Setup

### 1. Dependencies installeren

```bash
npm install --save-dev nock pixelmatch pngjs puppeteer
```

### 2. Baseline creation (eerste keer)

```bash
# API baselines worden automatisch aangemaakt bij eerste run
npm run test:regression:contracts

# Config baselines
npm run test:regression:config

# Visual baselines (vereist running server)
npm start &
npm run test:regression:visual
```

### 3. Release integratie verificatie

```bash
# Test volledige release check pipeline
./scripts/release-check.sh

# Test enkel regression componenten
npm run test:full-regression
```

## Directory Structuur

```
__tests__/regression/
├── api-contract-validation.test.js     # API contract testing
├── critical-path.e2e.test.js          # E2E workflows
├── config-migration.test.js           # Config schema validation
├── external-services.test.js          # External API mocking
├── visual-regression.test.js          # Visual diff testing
├── contracts/                         # API contract baselines
├── config-baselines/                  # Config schema baselines
├── service-contracts/                 # External service contracts
├── visual-baselines/                  # Screenshot baselines
├── visual-output/                     # Test screenshots
└── visual-diffs/                      # Diff images
```

## Failure Scenarios & Resolution

### API Contract Failures

- **Symptoom**: Tests falen met "Breaking change detected"
- **Oplossing**: Review API changes, update contracts indien gewenst

```bash
# Update contract baselines na review
npm run test:regression:contracts -- --updateBaselines
```

### Config Schema Failures

- **Symptoom**: "Schema validation failed" of "Migration path broken"
- **Oplossing**: Update config validation logic, test migration paths

### Visual Regression Failures

- **Symptoom**: Screenshots verschillen meer dan threshold (10%)
- **Oplossing**: Review visual changes, update baselines indien correct

```bash
# View visual regression report
open __tests__/regression/visual-output/visual-regression-report.html

# Update visual baselines na review
# (Individueel per scenario of automatisch via test options)
```

### External Service Contract Failures

- **Symptoom**: Service mock responses wijken af van verwachte structuur
- **Oplossing**: Update service contracts of integratie code

## Performance Baselines

Alle regression tests monitoren performance:

- **API calls**: < 2000ms per endpoint
- **Config operations**: < 500ms voor schema validation
- **Visual captures**: < 30000ms per screenshot
- **E2E workflows**: Variabel per scenario

## Best Practices

1. **Run regression tests voor elke PR**: GitHub Actions doet dit automatisch
2. **Update baselines bewust**: Niet automatisch accepteren van wijzigingen
3. **Monitor performance trends**: Check baselines regelmatig
4. **Review visual diffs**: Altijd controleren bij UI changes
5. **Test external service changes**: Update contracts bij provider API wijzigingen

## Monitoring & Alerting

- **GitHub Issues**: Automatisch aangemaakt bij dagelijkse regressie failures
- **PR Comments**: Regressie status wordt gecommentarieerd op PRs
- **Release Blocking**: API en config regressies blokkeren releases automatisch
- **Performance Alerts**: Significante performance degradatie wordt gedetecteerd

## Troubleshooting

### Puppeteer Installation Issues

```bash
# Linux dependencies voor visual testing
sudo apt-get install -y libnss3-dev libatk-bridge2.0-dev libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxkbcommon0 libgtk-3-0

# Alternative: gebruik puppeteer zonder sandbox
export PUPPETEER_ARGS='--no-sandbox --disable-setuid-sandbox'
```

### Test Timeouts

```bash
# Increase Jest timeout voor lange visual tests
jest.setTimeout(120000);

# Use --maxWorkers=1 voor resource-intensive tests
npm run test:regression:visual -- --maxWorkers=1
```

### Mock Service Issues

```bash
# Clear nock mocks bij test conflicts
beforeEach(() => nock.cleanAll());
afterAll(() => nock.restore());
```

Dit framework geeft je nu volledige automated regression detection zonder dat je er handmatig aan hoeft te denken - het wordt automatisch uitgevoerd bij elke release check en PR validation.
