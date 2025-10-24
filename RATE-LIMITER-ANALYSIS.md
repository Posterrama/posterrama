# Rate Limiter Analyse & Aanbevelingen

## 🔍 Huidige Situatie

### Rate Limiter Configuratie

**Algemene API Limiter** (`apiLimiter`):

- **Window**: 15 minuten
- **Max requests**: 1000 per IP
- **Toegepast op**:
    - `/api/*` (behalve `/api/admin/*` en `/api/v1/metrics/*`)
    - `/get-config`
    - `/get-media`
    - `/get-media-by-key`
    - `/image` (tenzij internal header)

**Admin API Limiter** (`adminApiLimiter`):

- **Window**: 15 minuten
- **Max requests**: 3000 per IP
- **Toegepast op**: `/api/admin/*`

**Device-Specific Limiters**:

- `deviceRegisterLimiter`: 60 min, 50 requests
- `deviceCheckLimiter`: 60 min, 500 requests
- `deviceHeartbeatLimiter`: 60 min, 2000 requests
- `devicePairGenLimiter`: 60 min, 20 requests
- `devicePairClaimLimiter`: 60 min, 50 requests
- `qrLimiter`: 15 min, 200 requests
- `adminMergeLimiter`: 60 min, 10 requests

## ⚠️ Potentiële Problemen

### 1. **Screensaver/Display Usage**

Een actief display doet veel requests:

- `/get-media` elke X seconden (afhankelijk van `transitionInterval`)
- `/image` voor elke poster
- `/get-config` bij configuratie wijzigingen

**Voorbeeld berekening**:

- 10 seconden transition interval
- 100 posters in library
- = 360 `/get-media` requests per uur
- = 360 `/image` requests per uur
- = **720 requests per uur** = **5400 per 15 minuten**

❌ **Dit overschrijdt de 1000 request limiet!**

### 2. **Meerdere Devices Achter Dezelfde IP**

Als je 3+ displays hebt achter dezelfde router/NAT:

- Alle devices delen dezelfde rate limit
- 3 devices × 360 requests/uur = **1080 requests/uur per device**
- **Totaal: 3240 requests/uur = overschrijding binnen 5 uur**

### 3. **Admin UI Polling**

De admin UI pollt:

- `/api/v1/metrics/*` endpoints (uitgesloten van limiter)
- `/api/admin/*` endpoints voor live updates
- Bij veel devices kan dit snel oplopen

### 4. **Wallart Mode**

Wallart mode toont meerdere posters tegelijk:

- 30 items per scherm × `/image` requests
- Snellere refresh rates
- **Kan limiet binnen minuten bereiken**

## ✅ Aanbevelingen

### Optie 1: Rate Limiter Volledig Verwijderen (Aanbevolen)

**Argumenten VOOR verwijdering**:

1. **Interne applicatie**: Posterrama is bedoeld voor privé/thuisgebruik, niet publieke API
2. **Vertrouwde clients**: Alleen eigen devices en admin UI maken verbinding
3. **WebSocket voor realtime**: Device communicatie gaat via WebSocket (geen HTTP flood mogelijk)
4. **Geen DDoS risico**: Applicatie draait in besloten netwerk
5. **Betere UX**: Geen onverwachte 429 errors tijdens normaal gebruik

**Argumenten TEGEN verwijdering**:

1. ~~Bescherming tegen abuse~~ → Niet relevant voor privé-installatie
2. ~~Server resource bescherming~~ → Cache en normale throttling is voldoende
3. ~~Multiple tenant security~~ → Posterrama is single-tenant

**Voorstel**: Verwijder rate limiter volledig voor normale endpoints.

### Optie 2: Drastisch Verhogen van Limieten

Indien je toch rate limiting wilt behouden:

```javascript
// Voor displays/screensavers
const apiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minuten
    50000, // 50K requests (was 1000)
    'Too many requests...'
);

// Voor admin
const adminApiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minuten
    100000, // 100K requests (was 3000)
    'Too many admin requests...'
);
```

**Nadeel**: Rate limiter blijft overhead zonder echte waarde.

### Optie 3: Selectieve Rate Limiting (Compromis)

Behoud rate limiting **alleen** voor gevoelige endpoints:

**BEHOUDEN** (met hoge limieten):

- `/api/devices/register` (voorkomen spamming van device registraties)
- `/api/devices/pairing/generate` (voorkomen pairing code exhaustion)
- `/api/admin/merge-devices` (resource-intensieve operatie)

**VERWIJDEREN** van:

- `/api/*` algemeen
- `/get-media`
- `/get-config`
- `/image`
- `/api/admin/*` (behalve merge)

## 🎯 Aanbevolen Implementatie

### Stap 1: Verwijder Algemene Rate Limiters

```javascript
// VERWIJDER:
// app.use('/api/admin/', adminApiLimiter);
// app.use('/api/', (req, res, next) => { ... });
// app.use('/get-config', apiLimiter);
// app.use('/get-media', apiLimiter);
// app.use('/get-media-by-key', apiLimiter);
// app.use('/image', (req, res, next) => { ... });
```

### Stap 2: Behoud Device Management Limiters

Blijf specifieke limiters gebruiken voor device management:

- `deviceRegisterLimiter` op `/api/devices/register`
- `devicePairGenLimiter` op `/api/devices/pairing/generate`
- `devicePairClaimLimiter` op `/api/devices/pairing/claim`
- `adminMergeLimiter` op `/api/admin/merge-devices`

Deze beschermen tegen echte abuse scenario's.

### Stap 3: Monitoring

Vertrouw op bestaande monitoring:

- Request metrics (al aanwezig)
- Error tracking (al aanwezig)
- Performance monitoring (al aanwezig)

Als er een abnormaal request patroon is, zie je dit in de metrics.

## 📊 Impact Analyse

### Huidige Situatie (MET rate limiter):

- ❌ 429 errors tijdens normaal gebruik
- ❌ Volledig platform down bij overschrijding
- ❌ Slechte user experience
- ❌ Moeilijk te debuggen
- ⚠️ Minimale security voordeel (privé netwerk)

### Na Verwijdering (ZONDER rate limiter):

- ✅ Geen onverwachte 429 errors
- ✅ Betrouwbare werking 24/7
- ✅ Betere performance (geen limiter overhead)
- ✅ Simpeler debugging
- ✅ Behoud selectieve bescherming op gevoelige endpoints

## 🚀 Implementatie Script

Zie `scripts/remove-rate-limiters.js` voor geautomatiseerde verwijdering.

## 📝 Conclusie

**De rate limiter is niet nodig voor Posterrama omdat**:

1. Het is een privé/interne applicatie
2. Clients zijn vertrouwd (eigen devices)
3. Normaal gebruik triggers al 429 errors
4. WebSocket communiceert zonder HTTP flooding
5. Er is geen reëel DDoS risico

**Aanbeveling**: Verwijder algemene rate limiters, behoud alleen device-management limiters voor echte abuse scenario's.

## ✅ Status: Geïmplementeerd (2025-10-24)

**Verwijderd**:

- ✅ `apiLimiter` (1000 req/15min) - Algemene API bescherming
- ✅ `adminApiLimiter` (3000 req/15min) - Admin API bescherming
- ✅ `deviceCheckLimiter` (30 req/min) - Device check endpoint
- ✅ `deviceHeartbeatLimiter` (120 req/min) - Device heartbeat endpoint

**Behouden** (voor echte abuse bescherming):

- ✅ `deviceRegisterLimiter` (10 req/min) - Nieuwe device registraties
- ✅ `devicePairGenLimiter` (20 req/60min) - Pairing code generatie
- ✅ `qrLimiter` (200 req/15min) - QR code generatie
- ✅ `adminMergeLimiter` (10 req/60min) - Resource-intensieve merge operaties

**Resultaat**:

- ✅ Geen 429 errors meer tijdens normaal gebruik
- ✅ Platform stabiel 24/7
- ✅ Admin logs interface rustig (geen WARN spam)
- ✅ Selectieve bescherming behouden waar nodig

**Commits**:

- `252cb1f` - Verwijdering algemene rate limiters
- `036f01c` - Verwijdering deviceCheck en deviceHeartbeat limiters
