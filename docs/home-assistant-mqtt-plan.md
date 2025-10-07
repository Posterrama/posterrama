# Home Assistant MQTT Integration Plan voor Posterrama

## Overzicht

Dit document beschrijft het implementatieplan voor het toevoegen van Home Assistant support aan Posterrama via MQTT met automatische discovery. Het doel is om alle instellingen en device informatie beschikbaar te maken in Home Assistant voor monitoring en controle.

## Huidige Architectuur

**Posterrama heeft al:**

- Uitgebreide admin API (`/api/admin/*`) met alle configuratie-opties
- WebSocket hub voor real-time device communicatie (`/ws/devices`)
- Device management systeem (`deviceStore.js`) met per-device instellingen
- OpenAPI/Swagger documentatie die altijd up-to-date is
- Configuration management met `config.json`
- Live metrics en status informatie

**Home Assistant MQTT Discovery:**

- Automatische detectie via speciale discovery topics
- Bidirectionele communicatie (lezen + schrijven)
- Real-time updates via MQTT
- Ondersteuning voor alle entity types (switch, sensor, number, text, etc.)

## Implementatie Strategie

### Fase 1: MQTT Infrastructure (2-3 dagen)

**Nieuwe files:**

- `utils/mqtt-client.js` - MQTT client management
- `utils/ha-discovery.js` - Home Assistant discovery generator
- `config/mqtt-config.js` - MQTT configuratie

**Functionaliteit:**

```javascript
// MQTT Client met reconnection logic
class MQTTClient {
    constructor(brokerUrl, options) {}
    connect() {}
    disconnect() {}
    publish(topic, payload, options) {}
    subscribe(topic, callback) {}
    onMessage(topic, callback) {}
}

// Discovery topic generator
class HADiscovery {
    generateEntityConfig(entityType, config) {}
    publishDiscovery(entity) {}
    removeEntity(entityId) {}
}
```

**Environment variabelen toevoegen:**

```env
# MQTT Configuration for Home Assistant Integration
MQTT_ENABLED=false
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TOPIC_PREFIX=posterrama
MQTT_DISCOVERY_PREFIX=homeassistant
MQTT_CLIENT_ID=posterrama-server
```

### Fase 2: Entity Mapping Generator (3-4 dagen)

**Automatische entity detectie via bestaande API:**

```javascript
// Parse OpenAPI spec voor automatische entity generatie
class EntityMapper {
    async generateEntitiesFromAPI() {
        const apiSpec = require('../docs/openapi-latest.json');
        const entities = [];

        // Parse /api/admin/config schema voor settings
        this.parseConfigSchema(apiSpec, entities);

        // Parse device endpoints voor device entities
        this.parseDeviceEndpoints(apiSpec, entities);

        // Parse metrics endpoints voor sensors
        this.parseMetricsEndpoints(apiSpec, entities);

        return entities;
    }

    parseConfigSchema(spec, entities) {
        // Genereer entities voor:
        // - mediaServers[].enabled -> switch
        // - backgroundRefreshMinutes -> number
        // - transitionIntervalSeconds -> number
        // - showRottenTomatoes -> switch
        // - clockFormat -> select
        // - etc.
    }
}
```

**Entity Types Mapping:**

| Posterrama Setting           | HA Entity Type  | Voorbeeld                  |
| ---------------------------- | --------------- | -------------------------- |
| `mediaServers[].enabled`     | `switch`        | Plex Server On/Off         |
| `backgroundRefreshMinutes`   | `number`        | Refresh Interval (30-1440) |
| `showRottenTomatoes`         | `switch`        | Show RT Scores             |
| `clockFormat`                | `select`        | 12h/24h/hidden             |
| `rottenTomatoesMinimumScore` | `number`        | Min RT Score (0-100)       |
| `mediaServers[].hostname`    | `text`          | Plex Hostname              |
| Device online status         | `binary_sensor` | Device Online              |
| Playlist item count          | `sensor`        | Media Count                |
| Last fetch time              | `sensor`        | Last Update                |
| Refresh playlist             | `button`        | Trigger Refresh            |
| Clear cache                  | `button`        | Clear Cache                |

### Fase 3: Bidirectionele Sync (2-3 dagen)

**State Publishing:**

```javascript
class StatePublisher {
    async publishConfigState() {
        const config = await readConfig();

        // Publish alle config values naar state topics
        for (const entity of this.entities) {
            const value = this.extractConfigValue(config, entity.path);
            await this.mqtt.publish(entity.stateTopic, value);
        }
    }

    async publishDeviceStates() {
        const devices = deviceStore.getAllDevices();
        for (const device of devices) {
            await this.publishDeviceState(device);
        }
    }
}
```

**Command Handling:**

```javascript
class CommandHandler {
    async handleConfigCommand(topic, payload) {
        const entity = this.findEntityByCommandTopic(topic);
        const configPatch = this.createConfigPatch(entity, payload);

        // Gebruik bestaande saveConfigPatch API
        await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: configPatch, env: {} }),
        });
    }

    async handleDeviceCommand(topic, payload) {
        const { deviceId, setting } = this.parseDeviceCommandTopic(topic);

        // Gebruik WebSocket hub voor real-time updates
        await wsHub.sendApplySettings(deviceId, { [setting]: payload });
    }
}
```

### Fase 4: Device Integration (1-2 dagen)

**Per-device entities in Home Assistant:**

```javascript
// Elke connected device wordt een HA device
class DeviceManager {
    async createDeviceEntities(device) {
        const deviceInfo = {
            name: device.name || `Posterrama Display ${device.id.slice(0, 8)}`,
            identifiers: [device.id],
            manufacturer: 'Posterrama',
            model: 'Display Device',
            sw_version: device.version,
        };

        const entities = [
            // Online status sensor
            {
                type: 'binary_sensor',
                name: 'Online',
                state_topic: `${prefix}/device/${device.id}/online`,
                device_class: 'connectivity',
            },

            // Per-device settings als entities
            {
                type: 'number',
                name: 'Transition Interval',
                command_topic: `${prefix}/device/${device.id}/set/transitionInterval`,
                state_topic: `${prefix}/device/${device.id}/transitionInterval`,
                min: 1,
                max: 60,
                unit: 'seconds',
            },

            // Device actions
            {
                type: 'button',
                name: 'Refresh Display',
                command_topic: `${prefix}/device/${device.id}/refresh`,
            },
        ];

        for (const entity of entities) {
            entity.device = deviceInfo;
            await this.haDiscovery.publishDiscovery(entity);
        }
    }
}
```

### Fase 5: Auto-Discovery Updates (1 dag)

**Automatische sync bij config changes:**

```javascript
// Hook into bestaande config save logic
const originalSaveConfig = require('./config').writeConfig;

async function writeConfigWithMQTT(newConfig) {
    // Save config zoals normaal
    await originalSaveConfig(newConfig);

    // Update HA entities als MQTT enabled
    if (process.env.MQTT_ENABLED === 'true') {
        await mqttManager.updateDiscoveryFromConfig(newConfig);
        await mqttManager.publishConfigState(newConfig);
    }
}

// Hook into WebSocket events voor real-time updates
wsHub.events.on('deviceSettingsChanged', async (deviceId, settings) => {
    if (mqttManager.isEnabled()) {
        await mqttManager.publishDeviceState(deviceId, settings);
    }
});
```

## File Structure

```
utils/
├── mqtt-client.js           # MQTT client wrapper
├── ha-discovery.js          # Home Assistant discovery
├── ha-entity-mapper.js      # API -> HA entity mapping
└── ha-state-manager.js      # State sync manager

config/
└── mqtt-schema.json         # MQTT config validation

middleware/
└── mqtt-middleware.js       # MQTT integratie in Express

__tests__/
└── mqtt/
    ├── mqtt-client.test.js
    ├── ha-discovery.test.js
    └── entity-mapper.test.js
```

## Configuration Example

**In `config.json`:**

```json
{
    "mqtt": {
        "enabled": false,
        "brokerUrl": "mqtt://localhost:1883",
        "username": "",
        "password": "",
        "topicPrefix": "posterrama",
        "discoveryPrefix": "homeassistant",
        "retainMessages": true,
        "updateInterval": 30
    }
}
```

**Generated HA entities:**

```yaml
# Automatisch gegenereerd in Home Assistant
switch.posterrama_plex_server_enabled:
    name: 'Plex Server Enabled'
    state_topic: 'posterrama/config/mediaServers/plex/enabled'
    command_topic: 'posterrama/config/mediaServers/plex/enabled/set'

number.posterrama_refresh_interval:
    name: 'Refresh Interval'
    state_topic: 'posterrama/config/backgroundRefreshMinutes'
    command_topic: 'posterrama/config/backgroundRefreshMinutes/set'
    min: 30
    max: 1440
    unit_of_measurement: 'minutes'

sensor.posterrama_media_count:
    name: 'Media Count'
    state_topic: 'posterrama/status/mediaCount'
    unit_of_measurement: 'items'

button.posterrama_refresh_playlist:
    name: 'Refresh Playlist'
    command_topic: 'posterrama/action/refreshPlaylist'
```

## Voordelen van deze Approach

1. **Volledig Automatisch**: Gebruikt bestaande OpenAPI spec, geen handmatige mapping
2. **Altijd Up-to-date**: Nieuwe config opties verschijnen automatisch in HA
3. **Bidirectioneel**: Lezen én schrijven via HA dashboard/automations
4. **Real-time**: WebSocket events zorgen voor directe updates
5. **Device Support**: Elk connected device krijgt eigen entities
6. **Future-proof**: API changes worden automatisch opgepikt

## Development Timeline

- **Week 1**: Fase 1-2 (MQTT client + entity mapping)
- **Week 2**: Fase 3-5 (sync logic + device integration + testing)

**Totaal: ~10-12 dagen development**

## Testing Strategy

1. **Unit tests** voor alle nieuwe modules
2. **Integration tests** met echte MQTT broker
3. **Home Assistant test setup** voor end-to-end validatie
4. **Device simulation** voor multi-device scenarios

## Conclusie

Deze implementatie geeft Posterrama native Home Assistant integratie met:

- ✅ Dashboard widgets voor alle settings
- ✅ Automations (bijv. restart bij server changes)
- ✅ Mobile app controle via HA app
- ✅ Voice control via HA integrations
- ✅ Monitoring en alerting
- ✅ Automatische discovery van nieuwe features

De complexity is medium-hoog maar zeer haalbaar door gebruik te maken van de bestaande solide API structuur van Posterrama.
