# Posterrama MQTT Setup Guide

Complete guide for integrating Posterrama with Home Assistant via MQTT.

**Version**: 2.9.8
**Last Updated**: 2025-11-28
**Prerequisites**: Posterrama v2.9.3+, Home Assistant with MQTT broker

**Quick Troubleshooting:**

- Not connecting? Check broker IP and credentials in config.json
- 🟡 Entities not appearing? Ensure discovery.enabled: true and restart Posterrama
- 🟢 Works but slow? Increase publishInterval to 60 seconds

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Installation Steps](#installation-steps)
4. [Configuration](#configuration)
5. [Home Assistant Discovery](#home-assistant-discovery)
6. [Available Entities](#available-entities)
7. [Usage Examples](#usage-examples)
8. [Troubleshooting](#troubleshooting)
9. [Advanced Configuration](#advanced-configuration)
10. [FAQ](#faq)

---

## Quick Start

**TL;DR**: Enable MQTT in config.json → Devices auto-appear in Home Assistant → Control from dashboard.

```bash
# 1. Edit config.json
nano /var/www/posterrama/config.json

# 2. Enable MQTT (see Configuration section)
# 3. Restart Posterrama
pm2 restart posterrama

# 4. Check Home Assistant → Settings → Devices & Services → MQTT
# Your devices appear automatically under "Posterrama" manufacturer
```

---

## Prerequisites

### Required

- **Posterrama**: v2.8.1 or higher
- **Home Assistant**: Any recent version (2023.x+)
- **MQTT Broker**: One of:
- Mosquitto (built into Home Assistant)
- External MQTT broker (optional)

### Recommended Knowledge

- Basic Home Assistant configuration
- YAML editing (for automations)
- Basic networking (IP addresses, ports)

---

## Installation Steps

### Step 1: Verify MQTT Broker

**If using Home Assistant's built-in Mosquitto:**

1. Go to **Settings** → **Add-ons** → **Add-on Store**
2. Search for "Mosquitto broker"
3. Click **Install** (if not already installed)
4. Click **Start**
5. Enable **Start on boot**

**Check broker status:**

- Go to **Settings** → **Devices & Services** → **MQTT**
- Should show "Connected" status

### Step 2: Get MQTT Credentials

**Create dedicated Posterrama user (recommended):**

```bash
# SSH into Home Assistant
# Run in terminal add-on or SSH

# Create user
mosquitto_passwd -b /config/mosquitto/passwd posterrama YOUR_SECURE_PASSWORD

# Restart Mosquitto add-on to apply changes
```

**Or use existing Home Assistant credentials:**

- Username: Your HA username
- Password: Your HA password

### Step 3: Configure Posterrama

1. **Open config.json:**

```bash
cd /var/www/posterrama
nano config.json
```

2. **Enable MQTT section:**

```json
{
    "mqtt": {
        "enabled": true,
        "broker": {
            "host": "192.168.1.100",
            "port": 1883,
            "username": "posterrama",
            "passwordEnvVar": "MQTT_PASSWORD",
            "tls": false
        },
        "discovery": {
            "enabled": true,
            "prefix": "homeassistant"
        },
        "topicPrefix": "posterrama",
        "publishInterval": 30,
        "availability": {
            "enabled": true,
            "timeout": 60
        }
    }
}
```

3. **Set password in .env:**

```bash
nano .env
# Add line:
MQTT_PASSWORD=YOUR_SECURE_PASSWORD
```

**Configuration parameters:**

- `host`: IP address of your MQTT broker (Home Assistant IP)
- `port`: Default 1883 (8883 for TLS)
- `username`: MQTT username
- `passwordEnvVar`: Environment variable name containing password
- `tls`: Set `true` if using encrypted connection
- `discovery.enabled`: Auto-create entities in Home Assistant
- `discovery.prefix`: Usually "homeassistant" (don't change)
- `topicPrefix`: MQTT topic prefix (default "posterrama")
- `publishInterval`: State update frequency in seconds
- `availability.timeout`: Mark device offline after X seconds

### Step 4: Restart Posterrama

```bash
# If using PM2
pm2 restart posterrama

# Or if running directly
npm start
```

### Step 5: Verify Connection

**Check Posterrama logs:**

```bash
pm2 logs posterrama --lines 50 | grep -i mqtt
```

**Expected output:**

```
 Initializing MQTT bridge...
 Connected to MQTT broker
 Publishing Home Assistant discovery configs...
 Published discovery for device living-room-display
 MQTT bridge initialized successfully
```

**Check Admin UI:**

1. Go to http://localhost:4000/admin
2. Scroll to **Operations** section
3. **MQTT Integration** card should show:

- 🟢 **Connected** (green pill)
- Broker info
- Connected devices

**Check Home Assistant:**

1. Go to **Settings** → **Devices & Services** → **MQTT**
2. Click **DEVICES** tab
3. You should see devices with manufacturer "Posterrama"

---

## Configuration

### Basic Configuration

Minimal working config:

```json
{
    "mqtt": {
        "enabled": true,
        "broker": {
            "host": "192.168.1.100",
            "port": 1883,
            "username": "posterrama",
            "passwordEnvVar": "MQTT_PASSWORD"
        }
    }
}
```

### Advanced Configuration

Full configuration with all options:

```json
{
    "mqtt": {
        "enabled": true,
        "broker": {
            "host": "homeassistant.local",
            "port": 8883,
            "username": "posterrama",
            "passwordEnvVar": "MQTT_PASSWORD",
            "tls": true,
            "ca": "/path/to/ca.crt",
            "cert": "/path/to/client.crt",
            "key": "/path/to/client.key",
            "rejectUnauthorized": true
        },
        "discovery": {
            "enabled": true,
            "prefix": "homeassistant"
        },
        "topicPrefix": "posterrama",
        "publishInterval": 15,
        "availability": {
            "enabled": true,
            "timeout": 90
        },
        "qos": 1,
        "retain": true
    }
}
```

**Parameter reference:**

| Parameter                   | Default         | Description                          |
| --------------------------- | --------------- | ------------------------------------ |
| `enabled`                   | `false`         | Enable/disable MQTT integration      |
| `broker.host`               | `localhost`     | MQTT broker hostname or IP           |
| `broker.port`               | `1883`          | MQTT broker port (8883 for TLS)      |
| `broker.username`           | -               | MQTT username (optional)             |
| `broker.passwordEnvVar`     | -               | Environment variable with password   |
| `broker.tls`                | `false`         | Enable TLS/SSL encryption            |
| `broker.ca`                 | -               | Path to CA certificate               |
| `broker.cert`               | -               | Path to client certificate           |
| `broker.key`                | -               | Path to client private key           |
| `broker.rejectUnauthorized` | `true`          | Verify TLS certificates              |
| `discovery.enabled`         | `true`          | Auto-create Home Assistant entities  |
| `discovery.prefix`          | `homeassistant` | HA discovery prefix                  |
| `topicPrefix`               | `posterrama`    | Base topic for all messages          |
| `publishInterval`           | `30`            | State publish frequency (seconds)    |
| `availability.enabled`      | `true`          | Track device online/offline          |
| `availability.timeout`      | `60`            | Offline timeout (seconds)            |
| `qos`                       | `0`             | MQTT Quality of Service (0, 1, or 2) |
| `retain`                    | `false`         | Retain messages on broker            |

### Network Configuration

**Finding your Home Assistant IP:**

```bash
# Method 1: Home Assistant UI
# Settings → System → Network

# Method 2: Terminal
hostname -I

# Method 3: Router admin panel
# Look for device named "homeassistant"
```

**Firewall rules (if needed):**

```bash
# Allow MQTT port on Home Assistant
sudo ufw allow 1883/tcp comment 'MQTT'
sudo ufw allow 8883/tcp comment 'MQTT TLS'
```

---

## Home Assistant Discovery

### How Discovery Works

1. **Posterrama publishes discovery messages** to:

```
homeassistant/{entity_type}/posterrama_{device_id}/{capability}/config
```

2. **Home Assistant auto-creates entities:**

- Buttons (play, pause, next, refresh)
- Switches (clockWidget, showMetadata)
- Selects (mode, transitionEffect)
- Numbers (transitionInterval, uiScaling)
- Sensors (currentPoster, deviceInfo)
- Camera (current poster image)

3. **Entities grouped by device** in Home Assistant UI

### Discovery Topics

Example discovery topic structure:

```
homeassistant/button/posterrama_living-room/playback_play/config
homeassistant/switch/posterrama_living-room/display_clock/config
homeassistant/select/posterrama_living-room/mode_select/config
homeassistant/camera/posterrama_living-room/camera/config
```

### Rediscovering Devices

If devices don't appear in Home Assistant:

```bash
# Method 1: Restart Posterrama
pm2 restart posterrama

# Method 2: Force republish (in Posterrama admin)
# Go to Admin → MQTT Integration → Click "Reconnect"

# Method 3: Manual MQTT republish
mosquitto_pub -h localhost -t "posterrama/discovery/refresh" -m "1"
```

---

## Available Entities

### Overview by Category

Posterrama devices expose 50+ capabilities organized in categories:

| Category             | Entity Types           | Count | Examples                               |
| -------------------- | ---------------------- | ----- | -------------------------------------- |
| **Playback**         | Button                 | 7     | Play, Pause, Next, Previous, Shuffle   |
| **Power**            | Button                 | 3     | Restart, Sleep, Wake                   |
| **Navigation**       | Button                 | 4     | Next Poster, Previous Poster, Random   |
| **Mode Control**     | Select                 | 3     | Mode, Cinema Orientation, Layout       |
| **Display Settings** | Switch, Number         | 20+   | Clock, Metadata, UI Scaling, Intervals |
| **Cinema Mode**      | Switch, Select         | 10+   | Header/Footer, Ambilight, Specs        |
| **Wallart Mode**     | Switch, Number, Select | 15+   | Density, Animation, Layout             |
| **Device Info**      | Sensor                 | 8     | Current Poster, Library Size, Mode     |
| **Camera**           | Camera                 | 1     | Current Poster Image (base64)          |

### Playback Controls

**Buttons:**

- `button.living_room_play` - Resume playback
- `button.living_room_pause` - Pause playback
- `button.living_room_next` - Next item
- `button.living_room_previous` - Previous item
- `button.living_room_stop` - Stop playback
- `button.living_room_shuffle_on` - Enable shuffle
- `button.living_room_shuffle_off` - Disable shuffle

**Usage:**

```yaml
# Automation example
automation:
 - alias: 'Pause all displays at bedtime'
 trigger:
 - platform: time
 at: '23:00:00'
 action:
 - service: button.press
 target:
 entity_id: button.living_room_pause
```

### Power Management

**Buttons:**

- `button.living_room_restart` - Restart device
- `button.living_room_sleep` - Enter sleep mode
- `button.living_room_wake` - Wake from sleep

### Display Settings

**Switches (ON/OFF):**

- `switch.living_room_clock` - Show clock widget
- `switch.living_room_metadata` - Show media metadata
- `switch.living_room_poster` - Show poster
- `switch.living_room_clearlogo` - Show clear logo
- `switch.living_room_rotten_tomatoes` - Show RT scores

**Numbers (Sliders):**

- `number.living_room_transition_interval` (1-600 seconds)
- `number.living_room_ui_scaling_content` (50-200%)
- `number.living_room_ui_scaling_clearlogo` (50-200%)
- `number.living_room_ui_scaling_clock` (50-200%)
- `number.living_room_ui_scaling_global` (50-200%)

**Selects (Dropdowns):**

- `select.living_room_mode` (screensaver, wallart, cinema)
- `select.living_room_transition_effect` (fade, slide, kenburns, etc.)
- `select.living_room_clock_format` (12h, 24h)

### Mode Control

**Select entity for mode switching:**

```yaml
# Switch to wallart mode
service: select.select_option
target:
    entity_id: select.living_room_mode
data:
    option: 'wallart'
```

Available modes:

- `screensaver` - Classic slideshow mode
- `wallart` - Grid layout with hero poster
- `cinema` - Theater-style display

### Cinema Mode Settings

**Switches:**

- `switch.living_room_cinema_header_enabled`
- `switch.living_room_cinema_footer_enabled`
- `switch.living_room_cinema_ambilight_enabled`
- `switch.living_room_cinema_specs_resolution`
- `switch.living_room_cinema_specs_audio`

**Selects:**

- `select.living_room_cinema_header_text`
- `select.living_room_cinema_header_style` (classic, modern)
- `select.living_room_cinema_footer_type` (specs, marquee)
- `select.living_room_cinema_orientation` (auto, portrait, landscape)

**Numbers:**

- `number.living_room_cinema_ambilight_strength` (0-100%)

### Wallart Mode Settings

**Switches:**

- `switch.living_room_wallart_enabled`
- `switch.living_room_wallart_ambient_gradient`
- `switch.living_room_wallart_auto_refresh`
- `switch.living_room_wallart_hero_bias`

**Selects:**

- `select.living_room_wallart_density` (low, medium, high, ultra)
- `select.living_room_wallart_animation` (fade, slide, zoom, none)
- `select.living_room_wallart_layout` (heroGrid, masonry, grid)
- `select.living_room_wallart_hero_side` (left, right, top, bottom)

**Numbers:**

- `number.living_room_wallart_refresh_rate` (1-60 minutes)
- `number.living_room_wallart_randomness` (1-10)
- `number.living_room_wallart_items_per_screen` (10-100)
- `number.living_room_wallart_columns` (2-12)
- `number.living_room_wallart_transition_interval` (5-300 seconds)
- `number.living_room_wallart_hero_rotation` (1-120 minutes)

### Device Sensors

**Read-only sensors:**

- `sensor.living_room_current_poster` - Current poster title
- `sensor.living_room_mode` - Current display mode
- `sensor.living_room_library_size` - Total media items
- `sensor.living_room_last_update` - Last state update time
- `sensor.living_room_device_name` - Device friendly name
- `sensor.living_room_version` - Posterrama version
- `sensor.living_room_ip_address` - Device IP
- `sensor.living_room_uptime` - Device uptime (seconds)

### Camera Entity

**Current Poster Camera:**

- `camera.living_room_current_poster` - Live view of current poster
- Updates every 30 seconds (configurable)
- Base64 encoded image
- No external URL needed
- Works in dashboards, automations, notifications

**Usage in automations:**

```yaml
# Send current poster to phone
service: notify.mobile_app
data:
    message: 'Now showing in living room'
    data:
    image: "{{ state_attr('camera.living_room_current_poster', 'entity_picture') }}"
```

---

## Usage Examples

### Basic Automations

#### 1. Morning Movie Routine

```yaml
automation:
 - alias: 'Morning Movie Display'
 trigger:
 - platform: time
 at: '07:00:00'
 condition:
 - condition: state
 entity_id: binary_sensor.workday
 state: 'on'
 action:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'cinema'
 - service: switch.turn_on
 target:
 entity_id:
 - switch.living_room_cinema_header_enabled
 - switch.living_room_cinema_ambilight_enabled
 - service: select.select_option
 target:
 entity_id: select.living_room_cinema_header_text
 data:
 option: 'Good Morning'
```

#### 2. Bedtime Wallart

```yaml
automation:
 - alias: 'Bedtime Wallart Mode'
 trigger:
 - platform: time
 at: '22:00:00'
 action:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'wallart'
 - service: select.select_option
 target:
 entity_id: select.living_room_wallart_density
 data:
 option: 'low'
 - service: number.set_value
 target:
 entity_id: number.living_room_wallart_refresh_rate
 data:
 value: 10
```

#### 3. Movie Night Scene

```yaml
scene:
 - name: 'Movie Night'
 entities:
 select.living_room_mode: 'cinema'
 select.living_room_cinema_orientation: 'landscape'
 select.living_room_cinema_header_text: 'Feature Presentation'
 switch.living_room_cinema_header_enabled: on
 switch.living_room_cinema_footer_enabled: on
 switch.living_room_cinema_ambilight_enabled: on
 number.living_room_cinema_ambilight_strength: 80
```

#### 4. Pause All Displays

```yaml
script:
    pause_all_displays:
    alias: 'Pause All Posterrama Displays'
    sequence:
        - service: button.press
    target:
    entity_id:
        - button.living_room_pause
        - button.bedroom_pause
        - button.kitchen_pause
```

### Dashboard Cards

#### 1. Quick Controls Card

```yaml
type: entities
title: Living Room Display
entities:
    - entity: select.living_room_mode
    - entity: switch.living_room_clock
    - entity: switch.living_room_metadata
    - entity: number.living_room_transition_interval
    - entity: button.living_room_next
    - entity: button.living_room_pause
```

#### 2. Picture Entity Card (Current Poster)

```yaml
type: picture-entity
entity: camera.living_room_current_poster
camera_view: live
show_state: false
show_name: true
name: 'Now Showing'
```

#### 3. Cinema Controls

```yaml
type: vertical-stack
cards:
 - type: entities
 title: Cinema Mode
 entities:
 - entity: select.living_room_mode
 - entity: select.living_room_cinema_orientation
 - entity: switch.living_room_cinema_header_enabled
 - entity: select.living_room_cinema_header_text
 - entity: switch.living_room_cinema_footer_enabled
 - type: entities
 title: Ambilight
 entities:
 - entity: switch.living_room_cinema_ambilight_enabled
 - entity: number.living_room_cinema_ambilight_strength
```

#### 4. Wallart Controls

```yaml
type: entities
title: Wallart Settings
entities:
    - entity: switch.living_room_wallart_enabled
    - entity: select.living_room_wallart_density
    - entity: select.living_room_wallart_layout
    - entity: select.living_room_wallart_animation
    - entity: number.living_room_wallart_refresh_rate
    - entity: number.living_room_wallart_columns
```

#### 5. Multi-Device Control

```yaml
type: grid
columns: 2
square: false
cards:
 - type: button
 name: Pause All
 icon: mdi:pause
 tap_action:
 action: call-service
 service: script.pause_all_displays
 - type: button
 name: Cinema Mode
 icon: mdi:movie-open
 tap_action:
 action: call-service
 service: scene.turn_on
 target:
 entity_id: scene.movie_night
 - type: button
 name: Wallart Mode
 icon: mdi:view-gallery
 tap_action:
 action: call-service
 service: select.select_option
 target:
 entity_id:
 - select.living_room_mode
 - select.bedroom_mode
 data:
 option: wallart
 - type: button
 name: Next Poster
 icon: mdi:skip-next
 tap_action:
 action: call-service
 service: button.press
 target:
 entity_id:
 - button.living_room_next
 - button.bedroom_next
```

### Advanced Automations

#### 1. Weather-Based Display

```yaml
automation:
 - alias: 'Rainy Day Cozy Mode'
 trigger:
 - platform: state
 entity_id: weather.home
 to: 'rainy'
 action:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'cinema'
 - service: number.set_value
 target:
 entity_id: number.living_room_transition_interval
 data:
 value: 20
 - service: number.set_value
 target:
 entity_id: number.living_room_cinema_ambilight_strength
 data:
 value: 40
```

#### 2. Presence-Based Control

```yaml
automation:
 - alias: 'Display Control Based on Presence'
 trigger:
 - platform: state
 entity_id: binary_sensor.living_room_occupancy
 action:
 - choose:
 - conditions:
 - condition: state
 entity_id: binary_sensor.living_room_occupancy
 state: 'on'
 sequence:
 - service: button.press
 target:
 entity_id: button.living_room_wake
 - service: button.press
 target:
 entity_id: button.living_room_play
 - conditions:
 - condition: state
 entity_id: binary_sensor.living_room_occupancy
 state: 'off'
 - condition: state
 entity_id: binary_sensor.living_room_occupancy
 state: 'off'
 for:
 minutes: 30
 sequence:
 - service: button.press
 target:
 entity_id: button.living_room_sleep
```

#### 3. Content Rating Filter

```yaml
automation:
 - alias: 'Kids Mode - Filter Content'
 trigger:
 - platform: state
 entity_id: input_boolean.kids_mode
 to: 'on'
 action:
 - service: mqtt.publish
 data:
 topic: 'posterrama/living-room/command/settings'
 payload: >
 {
 "ratingFilter": ["G", "PG"],
 "genreFilter": "family,animation,comedy"
 }
```

#### 4. Time-of-Day Themes

```yaml
automation:
 - alias: 'Dynamic Display Themes'
 trigger:
 - platform: time
 at:
 - '06:00:00'
 - '12:00:00'
 - '18:00:00'
 - '22:00:00'
 action:
 - choose:
 # Morning: Cinema with "Good Morning"
 - conditions:
 - condition: time
 after: '06:00:00'
 before: '12:00:00'
 sequence:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'cinema'
 - service: select.select_option
 target:
 entity_id: select.living_room_cinema_header_text
 data:
 option: 'Good Morning'
 - service: number.set_value
 target:
 entity_id: number.living_room_ui_scaling_global
 data:
 value: 100

 # Afternoon: Wallart medium density
 - conditions:
 - condition: time
 after: '12:00:00'
 before: '18:00:00'
 sequence:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'wallart'
 - service: select.select_option
 target:
 entity_id: select.living_room_wallart_density
 data:
 option: 'medium'

 # Evening: Cinema with "Now Playing"
 - conditions:
 - condition: time
 after: '18:00:00'
 before: '22:00:00'
 sequence:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'cinema'
 - service: select.select_option
 target:
 entity_id: select.living_room_cinema_header_text
 data:
 option: 'Now Playing'
 - service: switch.turn_on
 target:
 entity_id: switch.living_room_cinema_ambilight_enabled

 # Night: Wallart low density
 - conditions:
 - condition: time
 after: '22:00:00'
 sequence:
 - service: select.select_option
 target:
 entity_id: select.living_room_mode
 data:
 option: 'wallart'
 - service: select.select_option
 target:
 entity_id: select.living_room_wallart_density
 data:
 option: 'low'
 - service: number.set_value
 target:
 entity_id: number.living_room_ui_scaling_global
 data:
 value: 80
```

---

## Troubleshooting

### Connection Issues

#### Problem: "MQTT not connecting"

**Check 1: Verify broker is running**

```bash
# On Home Assistant machine
systemctl status mosquitto

# Or check add-on status in HA UI
# Settings → Add-ons → Mosquitto broker → Should be "Running"
```

**Check 2: Test connection manually**

```bash
# From Posterrama server
mosquitto_sub -h YOUR_HA_IP -p 1883 -u posterrama -P YOUR_PASSWORD -t "homeassistant/#" -v

# Should show Home Assistant discovery messages
# If timeout: firewall or network issue
# If auth error: wrong credentials
```

**Check 3: Verify credentials**

```bash
# Check .env file
cat /var/www/posterrama/.env | grep MQTT_PASSWORD

# Test login
mosquitto_pub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD -t "test" -m "test"
```

**Check 4: Firewall rules**

```bash
# On Home Assistant machine
sudo ufw status | grep 1883

# Should show:
# 1883/tcp ALLOW Anywhere

# If not, add rule:
sudo ufw allow 1883/tcp
```

**Check 5: Network connectivity**

```bash
# From Posterrama server
ping YOUR_HA_IP
telnet YOUR_HA_IP 1883

# Should connect successfully
```

#### Problem: "Authentication failed"

**Solution 1: Verify username/password**

```bash
# Check Mosquitto password file
cat /config/mosquitto/passwd

# Should contain line like:
# posterrama:$6$random_hash...

# If missing, add user:
mosquitto_passwd -b /config/mosquitto/passwd posterrama YOUR_PASSWORD

# Restart Mosquitto
```

**Solution 2: Check passwordEnvVar**

```bash
# Verify environment variable exists
echo $MQTT_PASSWORD

# If empty, add to .env:
echo "MQTT_PASSWORD=your_actual_password" >> .env

# Restart Posterrama
pm2 restart posterrama
```

**Solution 3: Try without auth (testing only)**

Edit Mosquitto config to allow anonymous (temporary):

```yaml
# /config/mosquitto/mosquitto.conf
allow_anonymous: true
```

Restart Mosquitto and test. If works, issue is with auth.

### Discovery Issues

#### Problem: "Devices not appearing in Home Assistant"

**Solution 1: Force rediscovery**

```bash
# Method 1: Restart Posterrama
pm2 restart posterrama

# Method 2: Clear retained messages
mosquitto_pub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD -t "homeassistant/+/posterrama_+/+/config" -n -r

# Method 3: Restart Home Assistant
# Settings → System → Restart
```

**Solution 2: Check discovery prefix**

```json
// In config.json, verify:
{
    "mqtt": {
        "discovery": {
            "enabled": true,
            "prefix": "homeassistant" // Must match HA MQTT integration
        }
    }
}
```

**Solution 3: Monitor discovery topics**

```bash
# Subscribe to discovery topics
mosquitto_sub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD -t "homeassistant/#" -v | grep posterrama

# Should see messages like:
# homeassistant/button/posterrama_device-id/playback_play/config
```

**Solution 4: Check MQTT integration in HA**

1. Settings → Devices & Services → MQTT
2. Should show "Configured" status
3. If not, add integration:

- Click "Add Integration"
- Search "MQTT"
- Configure broker settings

#### Problem: "Entities unavailable (grey in HA)"

**Solution 1: Check device online**

```bash
# Check Posterrama device status
curl http://localhost:4000/admin/api/devices

# Verify device has recent heartbeat
```

**Solution 2: Check availability topics**

```bash
# Monitor availability
mosquitto_sub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD -t "posterrama/+/availability" -v

# Should show:
# posterrama/device-id/availability online
```

**Solution 3: Verify publishInterval**

```json
// In config.json:
{
    "mqtt": {
        "publishInterval": 30, // Try lower value like 15
        "availability": {
            "enabled": true,
            "timeout": 60 // Try higher value like 90
        }
    }
}
```

### Performance Issues

#### Problem: "MQTT consuming too many resources"

**Solution 1: Increase publishInterval**

```json
{
    "mqtt": {
        "publishInterval": 60 // From 30 to 60 seconds
    }
}
```

**Solution 2: Disable camera if not needed**

Camera entity sends base64 images (can be large):

```bash
# Monitor camera topic size
mosquitto_sub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD -t "posterrama/+/camera" -v | head -c 100

# If too frequent, modify publishInterval or disable camera in code
```

**Solution 3: Check broker load**

```bash
# Monitor Mosquitto logs
docker logs -f addon_core_mosquitto

# Look for connection spikes or errors
```

#### Problem: "State updates delayed"

**Solution 1: Lower publishInterval**

```json
{
    "mqtt": {
        "publishInterval": 10 // More frequent updates
    }
}
```

**Solution 2: Check network latency**

```bash
# Ping MQTT broker
ping YOUR_HA_IP

# Should be <10ms on local network
```

**Solution 3: Verify QoS settings**

```json
{
    "mqtt": {
        "qos": 1 // Guaranteed delivery (vs 0 = fire and forget)
    }
}
```

### Common Error Messages

#### Error: "ECONNREFUSED"

```
Error: connect ECONNREFUSED 192.168.1.100:1883
```

**Causes:**

- Broker not running
- Wrong IP address
- Firewall blocking port

**Solutions:**

1. Verify broker status (see Connection Issues)
2. Check IP address in config.json
3. Test with telnet (see above)

#### Error: "Not authorized"

```
Error: Connection refused: Not authorized
```

**Causes:**

- Wrong username/password
- User not in Mosquitto passwd file
- ACL restrictions

**Solutions:**

1. Verify credentials in .env
2. Check Mosquitto passwd file
3. Test manual connection (see above)

#### Error: "Protocol version not supported"

```
Error: Connection refused: Unacceptable protocol version
```

**Causes:**

- Broker expects specific MQTT version
- Client/server version mismatch

**Solutions:**

```json
// Add to config.json:
{
    "mqtt": {
        "broker": {
            "protocolVersion": 5 // Try 3, 4, or 5
        }
    }
}
```

#### Error: "Certificate verification failed"

```
Error: unable to verify the first certificate
```

**Causes:**

- Self-signed certificate
- CA not trusted

**Solutions:**

```json
// Disable verification (testing only):
{
 "mqtt": {
 "broker": {
 "rejectUnauthorized": false
 }
 }
}

// Or provide CA certificate:
{
 "mqtt": {
 "broker": {
 "ca": "/path/to/ca.crt"
 }
 }
}
```

### Debug Mode

Enable verbose MQTT logging:

```bash
# Method 1: Environment variable
export DEBUG=mqtt*
pm2 restart posterrama

# Method 2: PM2 config
pm2 restart posterrama --update-env --log-date-format "YYYY-MM-DD HH:mm:ss"

# Method 3: Check Posterrama logs
tail -f /var/www/posterrama/logs/combined.log | grep -i mqtt
```

### Health Check Endpoint

Verify MQTT status via API:

```bash
# Get MQTT status
curl http://localhost:4000/api/admin/mqtt/status

# Expected response:
{
 "enabled": true,
 "connected": true,
 "stats": {
 "messagesPublished": 1234,
 "messagesReceived": 56,
 "commandsExecuted": 12,
 "connectedAt": "2025-10-24T10:30:00.000Z",
 "uptime": 3600000
 },
 "deviceSummary": {
 "total": 3,
 "online": 3,
 "offline": 0
 }
}
```

---

## Advanced Configuration

### TLS/SSL Encryption

For secure MQTT connections:

```json
{
    "mqtt": {
        "broker": {
            "host": "homeassistant.local",
            "port": 8883,
            "tls": true,
            "ca": "/etc/ssl/certs/ca.crt",
            "cert": "/etc/ssl/certs/client.crt",
            "key": "/etc/ssl/private/client.key",
            "rejectUnauthorized": true
        }
    }
}
```

**Generate certificates:**

```bash
# Self-signed CA (testing only)
openssl req -new -x509 -days 365 -extensions v3_ca -keyout ca.key -out ca.crt

# Server certificate
openssl genrsa -out server.key 2048
openssl req -out server.csr -key server.key -new
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# Client certificate
openssl genrsa -out client.key 2048
openssl req -out client.csr -key client.key -new
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365
```

**Configure Mosquitto for TLS:**

```conf
# /config/mosquitto/mosquitto.conf
listener 8883
cafile /ssl/ca.crt
certfile /ssl/server.crt
keyfile /ssl/server.key
require_certificate true
```

### Custom Topic Structure

Override default topic structure:

```json
{
    "mqtt": {
        "topicPrefix": "home/displays",
        "topics": {
            "state": "home/displays/{device_id}/state",
            "command": "home/displays/{device_id}/command",
            "availability": "home/displays/{device_id}/online"
        }
    }
}
```

### Quality of Service (QoS)

Configure MQTT message reliability:

```json
{
    "mqtt": {
        "qos": 1, // 0 = At most once, 1 = At least once, 2 = Exactly once
        "retain": true // Retain last message on broker
    }
}
```

**QoS levels:**

- **QoS 0**: Fire and forget (fastest, least reliable)
- **QoS 1**: Guaranteed delivery (default, balanced)
- **QoS 2**: Exactly once (slowest, most reliable)

### Multiple MQTT Brokers

Not currently supported, but can be achieved with MQTT bridge:

```conf
# Mosquitto bridge config
connection bridge-to-cloud
address cloud.mqtt.broker:1883
topic posterrama/# both 0
```

### Custom Device Naming

Override device names in Home Assistant:

```bash
# Publish custom device config
mosquitto_pub -h YOUR_HA_IP -u posterrama -P YOUR_PASSWORD \
 -t "posterrama/living-room/command/settings" \
 -m '{"deviceName": "Living Room TV Display"}'
```

---

## FAQ

### General Questions

**Q: Do I need Home Assistant for MQTT?**
A: No, Posterrama works with any MQTT broker. Home Assistant discovery is optional but recommended for easy setup.

**Q: Can I use external MQTT brokers (CloudMQTT, AWS IoT)?**
A: Yes, configure `broker.host` to point to external broker. Ensure network access and credentials are correct.

**Q: How many devices can I connect?**
A: No hard limit. Tested with 20+ devices. Performance depends on `publishInterval` and broker capacity.

**Q: Does MQTT work offline?**
A: Devices need network access to MQTT broker. If broker is local (Home Assistant), works on LAN without internet.

**Q: Can I control devices without Home Assistant?**
A: Yes, send MQTT commands directly using mosquitto_pub or any MQTT client.

### Technical Questions

**Q: What MQTT version is supported?**
A: MQTT 3.1.1 and 5.0 (auto-negotiated).

**Q: Are messages retained?**
A: Discovery configs are retained. State messages can be configured with `retain: true`.

**Q: What happens if MQTT disconnects?**
A: Bridge auto-reconnects with exponential backoff. Devices continue working via WebSocket.

**Q: Can I use MQTT and WebSocket simultaneously?**
A: Yes, both work independently. MQTT for HA integration, WebSocket for direct device control.

**Q: How much bandwidth does MQTT use?**
A: Minimal. ~1KB per state update. Camera entity ~50-200KB per update (base64 image).

### Security Questions

**Q: Is MQTT traffic encrypted?**
A: Only if using TLS (port 8883). Plain MQTT (1883) is unencrypted. Use TLS for external brokers.

**Q: Should I use authentication?**
A: Yes, always use username/password, especially if broker is exposed to internet.

**Q: Can I restrict MQTT access by IP?**
A: Yes, configure Mosquitto ACLs or firewall rules.

**Q: Where are passwords stored?**
A: In environment variables (`.env` file), never in config.json. Ensure `.env` is not committed to git.

### Troubleshooting Questions

**Q: Why don't entities appear in Home Assistant?**
A: Check discovery enabled, correct prefix, MQTT integration configured, and restart Posterrama.

**Q: Why are entities unavailable?**
A: Device offline, MQTT disconnected, or availability timeout too low. Check device heartbeat and increase timeout.

**Q: Commands not working?**
A: Verify device online, check command topic, monitor logs for errors, test with mosquitto_pub manually.

**Q: Camera not updating?**
A: Check `publishInterval`, verify device has poster loaded, monitor camera topic size.

### Configuration Questions

**Q: What's the optimal publishInterval?**
A: 30 seconds for most use cases. Lower (10-15s) for real-time dashboards. Higher (60s+) for battery/bandwidth savings.

**Q: Should I enable availability tracking?**
A: Yes, shows device online/offline status in Home Assistant. Disable if causing false offline alerts.

**Q: Do I need discovery enabled?**
A: No, but highly recommended. Without it, you must manually create entities in Home Assistant.

**Q: Can I change topicPrefix after setup?**
A: Yes, but requires rediscovery. Old entities will become unavailable. Delete old entities manually in HA.

---

## Additional Resources

### Official Documentation

- **Posterrama Docs**: `/var/www/posterrama/docs/`
- **MQTT Plan**: `docs/HOME-ASSISTANT-MQTT-PLAN.md`
- **API Reference**: http://localhost:4000/api-docs
- **Admin Panel**: http://localhost:4000/admin

### MQTT Resources

- **MQTT.org**: https://mqtt.org/
- **Mosquitto**: https://mosquitto.org/
- **Home Assistant MQTT**: https://www.home-assistant.io/integrations/mqtt/
- **MQTT Explorer** (GUI tool): http://mqtt-explorer.com/

### Community & Support

- **GitHub Issues**: [Report bugs or request features]
- **Home Assistant Community**: https://community.home-assistant.io/
- **MQTT Cheat Sheet**: https://github.com/hobbyquaker/mqtt-cheatsheet

### Example Projects

**1. Complete Dashboard YAML:**
See `examples/home-assistant-dashboard.yaml` (if available)

**2. Automation Bundle:**
See `examples/posterrama-automations.yaml` (if available)

**3. Node-RED Flows:**
Compatible with Node-RED MQTT nodes for advanced automation

### Version History

- **v2.8.1** (2025-10-24): Added Admin UI MQTT Status Panel, comprehensive integration tests
- **v2.8.0** (2025-10): MQTT bridge implementation, Home Assistant discovery
- **v2.7.x** (2025-09): Foundation for MQTT support

---

## Next Steps

After completing setup:

1. **Verify all devices appear** in Home Assistant
2. **Create basic automation** (e.g., mode change on schedule)
3. **Add dashboard card** with quick controls
4. **Test camera entity** in dashboard
5. **Setup scenes** for different viewing modes
6. **Explore advanced settings** (wallart, cinema customization)
7. **Create automations** based on presence, time, weather
8. **Share your setup** with the community!

### Recommended First Automations

1. **Time-based mode switching** (morning cinema, evening wallart)
2. **Presence detection** (pause when away, resume when home)
3. **Scene activation** (movie night, guests arriving)
4. **Notification integration** (send current poster to phone)

### Monitoring & Maintenance

- **Check Admin UI MQTT Status** regularly
- **Monitor logs** for connection issues: `pm2 logs posterrama | grep -i mqtt`
- **Update Posterrama** when new versions available
- **Backup config.json** before major changes

---

**Happy Automating! **

_For issues or questions, check troubleshooting section or refer to Posterrama documentation._
