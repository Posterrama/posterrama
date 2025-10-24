/**
 * Home Assistant Dashboard Template Generator
 *
 * Generates Lovelace dashboard YAML configurations for selected Posterrama devices.
 * Uses existing MQTT entities published via mqttBridge.
 */

const logger = require('./logger');

class HADashboardGenerator {
    constructor() {
        this.version = '1.0.0';
    }

    /**
     * Generate dashboard YAML for selected devices
     * @param {Array} devices - Array of device objects to include
     * @param {Object} options - Generation options
     * @returns {string} YAML configuration
     */
    generateDashboard(devices = [], options = {}) {
        logger.info('🏠 Generating Home Assistant section', {
            deviceCount: devices.length,
        });

        const lines = [];

        // Header comments
        lines.push('# Posterrama Section for Home Assistant');
        lines.push(`# Generated: ${new Date().toISOString()}`);
        lines.push(`# Devices: ${devices.length}`);
        lines.push('#');
        lines.push('# Installation Instructions:');
        lines.push('# 1. Open your dashboard in Home Assistant');
        lines.push('# 2. Click "Edit Dashboard" (pencil icon)');
        lines.push('# 3. Click "+ Add Section" at the bottom');
        lines.push('# 4. Click the pencil icon on the new section to edit it');
        lines.push('# 5. Click the three dots (⋮) in top right → "Edit in YAML"');
        lines.push('# 6. Replace ALL content with the YAML below');
        lines.push('# 7. Click "Save"');
        lines.push('');

        // Section structure with grid layout
        lines.push('type: grid');
        lines.push('cards:');

        // Heading
        lines.push('  - type: heading');
        lines.push('    heading: Posterrama');
        lines.push('    heading_style: title');

        // Device cards
        if (devices.length > 0) {
            devices.forEach(device => {
                lines.push(this._generateDeviceCard(device));
            });
        }

        return lines.join('\n');
    }

    /**
     * Generate device card
     */
    _generateDeviceCard(device) {
        const deviceName = device.name || 'Unnamed Device';
        const deviceId = device.id || '';

        // Entity naming matches MQTT bridge: {capability}_{deviceShort}
        // Use first 8 chars of device ID (without dashes)
        // Example: ae4b77cb-... -> ae4b77cb -> camera.camera_preview_ae4b77cb
        const deviceShortId = this._sanitizeDeviceId(deviceId);

        return `  - type: vertical-stack
    title: ${deviceName}
    cards:
      # Main device card with poster and controls
      - type: grid
        columns: 2
        square: false
        cards:
          # Poster thumbnail (left side)
          - type: picture-entity
            entity: camera.camera_preview_${deviceShortId}
            show_state: false
            show_name: false
            camera_view: live
            aspect_ratio: '2:3'
            tap_action:
              action: more-info
          
          # Device info and controls (right side)
          - type: vertical-stack
            cards:
              # Quick controls
              - type: horizontal-stack
                cards:
                  - type: button
                    entity: switch.power_toggle_${deviceShortId}
                    name: Power
                    icon: mdi:power
                    tap_action:
                      action: toggle
                    show_state: true
                  - type: button
                    entity: select.mode_select_${deviceShortId}
                    name: Mode
                    icon: mdi:monitor-dashboard
                    tap_action:
                      action: more-info
                    show_state: true
              
              # Device status
              - type: glance
                entities:
                  - entity: sensor.device_status_${deviceShortId}
                    name: Status
                  - entity: sensor.device_mode_${deviceShortId}
                    name: Mode
                  - entity: sensor.device_wsstatus_${deviceShortId}
                    name: Connection
                show_name: true
                show_state: true
      
      # Playback controls
      - type: horizontal-stack
        cards:
          - type: button
            tap_action:
              action: call-service
              service: button.press
              target:
                entity_id: button.playback_previous_${deviceShortId}
            icon: mdi:skip-previous
            show_name: false
          - type: button
            tap_action:
              action: call-service
              service: button.press
              target:
                entity_id: button.playback_pause_${deviceShortId}
            icon: mdi:pause
            show_name: false
          - type: button
            tap_action:
              action: call-service
              service: button.press
              target:
                entity_id: button.playback_resume_${deviceShortId}
            icon: mdi:play
            show_name: false
          - type: button
            tap_action:
              action: call-service
              service: button.press
              target:
                entity_id: button.playback_next_${deviceShortId}
            icon: mdi:skip-next
            show_name: false
          - type: button
            tap_action:
              action: call-service
              service: button.press
              target:
                entity_id: button.playback_shuffle_${deviceShortId}
            icon: mdi:shuffle
            show_name: false
      
      # Now Playing - Compact info
      - type: entities
        title: Now Playing
        show_header_toggle: false
        entities:
          - entity: sensor.media_title_${deviceShortId}
            name: Title
            icon: mdi:movie-open
          - entity: sensor.media_year_${deviceShortId}
            name: Year
            icon: mdi:calendar
          - entity: sensor.media_rating_${deviceShortId}
            name: Rating
            icon: mdi:star
          - entity: sensor.media_contentrating_${deviceShortId}
            name: Content Rating
            icon: mdi:certificate
          - entity: sensor.media_genres_${deviceShortId}
            name: Genres
            icon: mdi:tag-multiple
          - entity: sensor.media_runtime_${deviceShortId}
            name: Runtime
            icon: mdi:clock-outline
      
      # Device info - Compact
      - type: entities
        title: Device Info
        show_header_toggle: false
        entities:
          - entity: sensor.device_id_${deviceShortId}
            name: Device ID
            icon: mdi:identifier
          - entity: sensor.device_location_${deviceShortId}
            name: Location
            icon: mdi:map-marker
          - entity: sensor.device_preset_${deviceShortId}
            name: Preset
            icon: mdi:tune
          - entity: sensor.device_resolution_${deviceShortId}
            name: Resolution
            icon: mdi:monitor
          - entity: sensor.device_clienttype_${deviceShortId}
            name: Client Type
            icon: mdi:application
          - entity: sensor.device_useragent_${deviceShortId}
            name: User Agent
            icon: mdi:web`;
    }

    /**
     * Sanitize device ID for entity names
     * Takes first 8 chars of UUID and makes alphanumeric
     */
    _sanitizeDeviceId(id) {
        return id.substring(0, 8).replace(/-/g, '').toLowerCase();
    }

    /**
     * Get preview info for dashboard
     */
    getPreviewInfo(devices = []) {
        const entityCount = devices.length * 15; // Approximate entities per device

        return {
            version: this.version,
            deviceCount: devices.length,
            estimatedEntityCount: entityCount,
            devices: devices.map(d => ({
                id: d.id,
                name: d.name,
                status: d.status,
                mode: d.clientInfo?.mode,
            })),
        };
    }
}

module.exports = new HADashboardGenerator();
