# 📦 Effectief Dependency Management

Een gids voor het beheren van dependencies in je Node.js project.

## 🎯 Huidige Dependency Status

### Production Dependencies (24)

- **Core**: Express.js, Node-fetch, Axios
- **Security**: Helmet, Bcrypt, Speakeasy, Express-validator
- **Data**: Joi, Ajv, Validator
- **Media APIs**: Plex-api, @jellyfin/sdk
- **Utilities**: Compression, CORS, Winston, Semver
- **Documentation**: Swagger-jsdoc, Swagger-ui-express

### Development Dependencies (8)

- **Testing**: Jest, Supertest
- **Code Quality**: ESLint, Prettier, Audit-ci
- **Development**: Nodemon

## � Geaccepteerde Security Risico's

### Plex API Dependencies

De volgende vulnerabilities zijn geaccepteerd als bekende risico's:

- **plex-api**: Kern Plex integratie - update zou breaking changes veroorzaken
- **plex-api-credentials**: Onderdeel van Plex API stack
- **request**: Legacy dependency van Plex API (deprecated maar functioneel)
- **request-promise**: Promise wrapper voor request
- **form-data**: Onderdeel van request stack
- **tough-cookie**: Cookie handling voor Plex API
- **xml2js**: XML parsing voor Plex responses

**Reden voor acceptatie:**

- Plex API is essentieel voor core functionaliteit
- Updates zouden breaking changes introduceren
- Vulnerabilities zijn primair in legacy request library
- Functies draaien in gecontroleerde server omgeving
- Geen directe user input processing

**Monitoring:**

- Security audit filtert deze packages uit
- Handmatige review bij major security updates
- Alternatieve Plex libraries worden gemonitord

## �🔍 Dependency Audit & Updates

### 1. Security Audit

```bash
# Controleer bekende beveiligingslekken
npm audit

# Probeer automatisch te fixen
npm audit fix

# Voor meer geavanceerde controle
npm run security:audit
```

### 2. Dependency Updates Controleren

```bash
# Installeer npm-check-updates globaal
npm install -g npm-check-updates

# Bekijk welke updates beschikbaar zijn
ncu

# Update alle dependencies naar latest
ncu -u && npm install

# Update alleen patch/minor versies (veiliger)
ncu -u --target minor && npm install
```

### 3. Specifieke Packages Updaten

```bash
# Update specifieke package
npm update axios

# Installeer specifieke versie
npm install axios@^1.7.7

# Installeer latest versie
npm install axios@latest
```

## 📊 Dependency Analyse Tools

### 1. Dependency Size Analyse

```bash
# Installeer bundlephobia CLI
npm install -g bundlephobia

# Analyseer package sizes
bundlephobia axios express

# Of gebruik online: https://bundlephobia.com/
```

### 2. Dependency Tree

```bash
# Bekijk dependency tree
npm ls

# Alleen top-level
npm ls --depth=0

# Zoek specifieke dependency
npm ls axios
```

### 3. Verouderde Dependencies

```bash
# Toon verouderde packages
npm outdated

# Met details
npm outdated --long
```

## 🛡️ Security Best Practices

### 1. Regelmatige Security Checks

```bash
# Voeg toe aan package.json scripts:
"security:check": "npm audit && npm outdated",
"security:fix": "npm audit fix"
```

### 2. Lock File Management

```bash
# Gebruik package-lock.json voor reproducible builds
# Commit altijd package-lock.json
git add package-lock.json

# Clean install (respecteert lock file exact)
npm ci
```

### 3. Dependency Scanning in CI/CD

Je hebt al `audit-ci` geïnstalleerd. Voeg toe aan GitHub Actions:

```yaml
# In .github/workflows/ci.yml
- name: Security Audit
  run: npm run security:audit
```

## 🎨 Dependency Categorieën Optimaliseren

### 1. Production vs Development

```bash
# Installeer als production dependency
npm install --save package-name

# Installeer als development dependency
npm install --save-dev package-name

# Production install (skip devDependencies)
npm install --production
```

### 2. Peer Dependencies

Voor libraries die andere projecten gebruiken:

```json
{
    "peerDependencies": {
        "express": "^4.0.0"
    }
}
```

### 3. Optional Dependencies

Voor packages die niet kritiek zijn:

```json
{
    "optionalDependencies": {
        "sharp": "^0.32.0"
    }
}
```

## 🔄 Update Strategie

### 1. Semantic Versioning

- **Patch** (1.0.1): Bug fixes - altijd safe
- **Minor** (1.1.0): Nieuwe features - meestal safe
- **Major** (2.0.0): Breaking changes - test grondig

### 2. Gefaseerde Updates

```bash
# Stap 1: Update alleen patch versies
ncu -u --target patch && npm install && npm test

# Stap 2: Update minor versies
ncu -u --target minor && npm install && npm test

# Stap 3: Update major versies één voor één
npm install package@latest && npm test
```

### 3. Testing na Updates

```bash
# Run alle tests
npm test

# Run lint checks
npm run lint

# Test de applicatie
npm start
```

## 📈 Performance Optimalisatie

### 1. Bundle Size Analyse

```bash
# Analyseer welke packages het meest ruimte innemen
npm ls --depth=0 --parseable | xargs du -sh

# Gebruik webpack-bundle-analyzer voor web apps
npm install --save-dev webpack-bundle-analyzer
```

### 2. Tree Shaking

Voor packages die tree shaking ondersteunen:

```javascript
// In plaats van
import _ from 'lodash';

// Gebruik
import debounce from 'lodash/debounce';
```

### 3. Alternative Packages

Overweeg lichtere alternatieven:

- `dayjs` in plaats van `moment`
- `ky` in plaats van `axios` voor kleinere bundles
- `zod` in plaats van `joi` voor TypeScript projecten

## 🛠️ Nuttige Scripts

Voeg deze toe aan je `package.json`:

```json
{
    "scripts": {
        "deps:check": "npm outdated",
        "deps:update": "ncu -u && npm install",
        "deps:update-safe": "ncu -u --target minor && npm install",
        "deps:audit": "npm audit",
        "deps:audit-fix": "npm audit fix",
        "deps:clean": "rm -rf node_modules package-lock.json && npm install",
        "deps:size": "npm ls --depth=0 --parseable | xargs du -sh | sort -hr"
    }
}
```

## 🚨 Troubleshooting

### 1. Dependency Conflicts

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Force resolutions (in package.json)
"overrides": {
  "package-name": "version"
}
```

### 2. Peer Dependency Warnings

```bash
# Installeer missing peer dependencies
npm install --save-dev missing-peer-dep
```

### 3. Version Conflicts

```bash
# Bekijk conflicting versions
npm ls package-name

# Force specific version
npm install package-name@version --force
```

## 📅 Maintenance Schema

### Wekelijks

- [ ] `npm audit` voor security issues
- [ ] Check `npm outdated` voor kleine updates

### Maandelijks

- [ ] Update patch versies
- [ ] Review en update development dependencies
- [ ] Clean install test: `rm -rf node_modules && npm install`

### Kwartaal

- [ ] Major dependency updates (met grondig testen)
- [ ] Dependency cleanup (ongebruikte packages verwijderen)
- [ ] Performance audit van bundle sizes

## 🎯 Voor Jouw Project

Gebaseerd op je huidige setup, hier zijn specifieke aanbevelingen:

### Immediate Actions

```bash
# 1. Security check
npm audit

# 2. Check outdated packages
npm outdated

# 3. Add dependency management scripts
# (Voeg bovenstaande scripts toe aan package.json)
```

### Monitoring Setup

```bash
# Voeg toe aan CI/CD pipeline
npm run deps:audit
npm run deps:check
```

Dit zorgt voor een robuust, veilig en up-to-date dependency management systeem! 🚀
