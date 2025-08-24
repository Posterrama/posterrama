# Posterrama - Bring your media library to life.

Transform any screen into a cinematic, always-fresh movie poster display.

<div align="center">

[![Version](https://img.shields.io/badge/version-1.9.4-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-681%20tests%20in%2047%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

<img src="./screenshots/screensaver.png" alt="Posterrama hero" width="740">

</div>

---

## Highlights

- **Screensaver Mode** and **Wallart Mode** with smooth, cinema‑quality visuals
- **Hero Poster Mode** — spotlight featured content with intelligent 4x4 grid layout
- Works with **Plex**, **TMDB**, **TVDB**, and popular streaming providers
- **Clean admin dashboard** with modern sliders and intuitive quick navigation
- **Smart caching** and image optimization for lightning-fast performance
- **Responsive design** for phones, tablets, TVs, and 4K displays
- **Cinema‑grade artwork**, clear logos/ratings, dynamic transitions
- **Advanced UI scaling** and customizable display settings

---

## Quick Start

One-line install:

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

Manual install:

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm install -g pm2
pm2 start ecosystem.config.js
```

Setup steps:

1. Open `http://your-server-ip:4000/admin/setup`
2. Create your admin account
3. Connect your media sources (Plex, TMDB, TVDB)
4. Tweak the display settings to taste
5. Visit `http://your-server-ip:4000` and enjoy

---

## Display Modes

<div align="center">

<img src="./screenshots/screensaver.png" alt="Screensaver Mode" width="30%">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/wallart.png" alt="Wallart Mode" width="30%">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/wallart_hero.png" alt="Wallart Hero Mode" width="30%">

<br>
<strong>Screensaver Mode</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>Wallart Mode</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>Wallart Hero Mode</strong>

</div>

- **Screensaver Mode** — single-poster, elegant presentation with cinematic Ken Burns effects
- **Wallart Mode** — intelligent multi-poster grid that dynamically fills your screen
- **Wallart Hero Mode** — spotlight a featured poster at 4x4 size with surrounding grid
    - Smart responsive layout adapts to any screen size and orientation
    - Perfect balance between featured content and discovery

---

## Multi-Device

<div align="center">

<img src="./screenshots/mobile.png" alt="Mobile" width="150">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/admin.png" alt="Admin" width="200">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/screensaver.png" alt="TV" width="200">

<br>
<strong>Mobile</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>Admin</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>TV</strong>

</div>

- Optimized layouts for mobile, tablet, desktop, and TV
- Great performance on Raspberry Pi 4+ and similar devices

---

## Features — what makes it awesome

### Visual experience

- **Cinema‑quality backgrounds** with smooth Ken Burns effects
- **Hero poster spotlight** — 4x4 featured poster with intelligent grid surrounds
- **Clean movie logos** and ratings overlays with perfect positioning
- **Dynamic transitions** and subtle animations that feel natural
- **Advanced layout engine** — responsive grids that eliminate black bars
- **Custom themes** and layouts that look stunning on any screen size

### Content & discovery

- Your media: Plex integration with rich metadata and artwork
- External sources: TMDB and TVDB enrichment
- Streaming discovery: Netflix, Disney+, Prime Video, Apple TV+, HBO Max, Hulu, Paramount+, Crunchyroll
- Smart filtering by rating, genre, release date, plus curated collections

### Performance & reliability

- **Smart caching** for instant image loads and offline resilience
- **Optimized for Raspberry Pi 4+** and low‑power devices
- **Multi-device responsive** — mobile, tablet, desktop, and TV layouts
- **Advanced error handling** with graceful fallbacks and recovery
- **Background processing** for seamless poster transitions

### Control

- **Clean web admin** with modern overlay sliders and intuitive navigation
- **Quick jump navigation** — click source icons to instantly scroll to sections
- **Real-time UI scaling** from 50% to 150% for perfect display tuning
- **Advanced wallart controls** — hero mode, refresh rates, and timing randomness
- **One‑line installer** and PM2 process management for easy deployment

---

## Platform Integration

### Android TV

1. Install "Dashboard" screensaver from Google Play
2. Set as screensaver in Android TV settings
3. Configure: `http://your-posterrama-ip:4000`

### Apple TV

- AirPlay from Safari (iPhone/iPad) and enable "Guided Access" if needed
- Or install a TV browser app and open your Posterrama URL

### Windows and macOS (PWA + Autostart)

Windows

- Open Posterrama in Edge or Chrome
- Menu → "Install app" / "Install this site as an app"
- Autostart: Win+R → shell:startup → drag the app shortcut into that folder

macOS

- Open Posterrama in Chrome or Edge
- Menu → "Install this site as an app" / "Install"
- System Settings → General → Login Items → add the app

Benefits

- Fullscreen without tabs, 2–3 steps, auto‑updates via the web

---

## Coming Soon — turn it up to eleven

### Cinema upgrades

- **Motion posters** and trailer snippets for dynamic backgrounds
- **Real‑time preview** in the admin for instant visual feedback
- **Advanced transition packs** and custom animation libraries
- **Wallart themes** — curated poster arrangements and layouts

### Universal sources

- **Emby and Jellyfin** support for broader media server compatibility
- **Kodi integration** for seamless home theater setups
- **Radarr/Sonarr/Lidarr** pipelines for automated collection management

### Multi‑display magic

- **Multiple screens** with smart sync and coordinated displays
- **Music visualizations** and ambient modes for audio libraries
- **Gaming libraries** and collections from Steam, Epic, etc.

## Updates

Update safely and keep file ownership correct:

```bash
# Recommended: update as the posterrama user
sudo -u posterrama git pull

# If you pulled as root, fix ownership then restart
chown -R posterrama:posterrama /var/www/posterrama
pm2 restart posterrama
```

---

## Requirements

- Node.js 18+
- Plex (recommended) or other configured sources

## License

GPL-3.0-or-later

[Issues](https://github.com/Posterrama/posterrama/issues) · [Discussions](https://github.com/Posterrama/posterrama/discussions)
