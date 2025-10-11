# Development Roadmap

Current development status and upcoming features for Posterrama.

### Installation & Setup

- [ ] Provide `device-presets.json` as a template on first boot, then allow adding custom presets

### Media Sources

- [ ] Emby integration
- [ ] Additional poster services
- [ ] Music library support (reuse existing sources; define display options)
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

### Modes

- [ ] Split each mode into its own HTML + minimal CSS (simpler maintenance)
    - [ ] `screensaver.html`
    - [ ] `cinema.html`
    - [ ] `wallart.html`

### Responsive Design

- [ ] Mobile

### UI/UX Improvements

- [ ] Poster hints from Posterr
- [ ] MoviePosterApp.com features:
    - [ ] Advanced transition effects
    - [ ] Font/size/color customization
    - [ ] Trailer support
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Curated playlists (franchises, directors, genres, "On this day", "New to Plex"), actors

### Device Management

- [ ] Multiple screens with smart sync and coordinated displays
- [ ] Online poster services; orientation-aware selection

### Display Behavior

- [ ] Slide animation: faster transition, longer still time
- [ ] Wallart: option to show metadata (Title, Year, Stars) — hero-only or all posters
- [ ] Wallart: add film card layout
- [ ] Cinema: film card / presets

### Rules & Schedules

- [ ] Time schedules (day/night, weekends); scenes as presets; seasonal themes (Halloween, Holidays)
- [ ] Sound and ambient modes
- [ ] Music visuals for audio libraries; ambient background for idle

## 🏗️ Technical Debt

### JavaScript Modularization

Current monolithic files need refactoring:

- `admin.js` (7,754 lines) → Split into modules
- `script.js` (2,760 lines) → Component-based architecture

**Target structure:**

```
js/
├── modules/
│   ├── state/           # State management
│   ├── ui/              # UI components
│   ├── media/           # Media handling
│   └── wallart/         # Wallart mode logic
├── admin/               # Admin interface
└── screensaver/         # Main display logic
```

**Goals:**

- No file >500 lines
- Single responsibility per module
- Maintain performance

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

### Smart TV Enhancements

- [ ] Android TV native app
- [ ] Apple TV screensaver integration
- [ ] Samsung Tizen app
- [ ] LG webOS integration

### Home Automation

- [ ] Home Assistant integration
- [ ] MQTT support for IoT
    - [ ] Entities (state, source, playing)
    - [ ] Automations (dim/pause on presence)
    - [ ] Topics for remote control

## 🔐 Security & Reliability

### Authentication

- [ ] LDAP/Active Directory integration
- [ ] OAuth providers (Google, GitHub)
- [ ] Role-based access control

### Device Identity

- [ ] Make each device unique (e.g., bind a client certificate)

## 🎬 Cinema Mode Enhancements

- [ ] Film card / presets for cinema mode

## ✨ Customization & Design

- [ ] Inverted high‑contrast font option (like Q dep / untamed style)
