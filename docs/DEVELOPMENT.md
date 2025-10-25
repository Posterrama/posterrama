# Development Roadmap

Open items and planned features for Posterrama (v2.8.1+).

## 📊 Current Status

**Version**: 2.8.1  
**Code Coverage**: 92.23% (1252/1253 tests passing)  
**Node.js**: v18+ required

## 📋 Open Items

### Installation & Setup

- [ ] Provide `device-presets.json` as a template on first boot, then allow adding custom presets

### Media Sources

- [ ] Emby integration
- [ ] Additional poster services
- [ ] Music library support (reuse existing sources; define display options)
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

### Responsive Design

- [ ] Mobile optimization

### UI/UX Improvements

- [ ] Poster hints from Posterr
- [ ] MoviePosterApp.com features:
    - [ ] Advanced transition effects
    - [ ] Font/size/color customization
    - [ ] Trailer support
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Curated playlists (franchises, directors, genres, "On this day", "New to Plex", actors)

### Device Management

- [ ] Multiple screens with smart sync and coordinated displays
- [ ] Online poster services with orientation-aware selection

### Display Behavior

- [ ] Slide animation: faster transition, longer still time
- [ ] Wallart: option to show metadata (Title, Year, Stars) — hero-only or all posters
- [ ] Wallart: add film card layout
- [ ] Cinema: film card / presets

### Rules & Schedules

- [ ] Time schedules (day/night, weekends)
- [ ] Scenes as presets
- [ ] Seasonal themes (Halloween, Holidays)
- [ ] Sound and ambient modes
- [ ] Music visuals for audio libraries
- [ ] Ambient background for idle

## 🏗️ Technical Debt

### JavaScript Modularization

- [ ] Refactor `admin.js` (7,754 lines) into modules
- [ ] Refactor `script.js` (2,760 lines) into component-based architecture
- [ ] Target: No file >500 lines, single responsibility per module

### Performance Optimizations

- [ ] Lazy loading for non-critical modules
- [ ] Image optimization pipeline

## 🎨 Wallart Mode Enhancements

### Animation System

- [ ] Theme-based layouts (genre-specific grids)
- [ ] Decade themes (80s neon, 90s grunge, etc.)
- [ ] Weather-based themes
- [ ] Time-of-day adaptive layouts

### Advanced Features

- [ ] 3D perspective effects
- [ ] Particle systems
- [ ] Interactive hover states
- [ ] AI-powered layout optimization

## 📱 Platform Integration

### Smart TV

- [ ] Android TV native app
- [ ] Apple TV screensaver integration
- [ ] Samsung Tizen app
- [ ] LG webOS integration

### Home Automation (MQTT)

- [ ] Complete settings testing (all 30+ settings end-to-end)
- [ ] Broadcast commands via MQTT (control all devices at once)
- [ ] Group controls integration (groups.json → virtual HA devices)
- [ ] Server metrics sensors (cache size, memory usage, device count)
- [ ] Event notifications (device connect/disconnect, library updates)
- [ ] End-to-end integration tests with real MQTT broker

## 🔐 Security & Authentication

### Authentication

- [ ] LDAP/Active Directory integration
- [ ] OAuth providers (Google, GitHub)
- [ ] Role-based access control

### Device Identity

- [ ] Make each device unique (e.g., bind a client certificate)

## 🎬 Cinema Mode

- [ ] Film card / presets for cinema mode

## ✨ Customization & Design

- [ ] Inverted high-contrast font option (like Q dep / untamed style)

## 🚀 Monitoring & Operations

- [ ] Prometheus metrics export
- [ ] Grafana dashboard templates
- [ ] Alerting system integration
- [ ] Automatic update notifications
