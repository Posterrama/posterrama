# Posterrama - Bring your media library to life.

---

Transform any screen into a cinematic, always-fresh movie poster display.

<div align="center">

<p style="margin: 0; line-height: 1.1;">
  <a href="https://github.com/Posterrama/posterrama"><img alt="Version" src="https://img.shields.io/badge/version-2.8.0-blue.svg"></a>
  <a href="https://github.com/Posterrama/posterrama/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/Posterrama/posterrama/total.svg"></a>
  <a href="./coverage/lcov-report/index.html"><img alt="Coverage" src="https://img.shields.io/badge/coverage-93.56%25-brightgreen.svg"></a>
  <a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/node.js-%E2%89%A518.0.0-blue"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue"></a>
</p>
<p style="margin: 2px 0 8px 0; line-height: 1.1;">
  <a href="#content-source-features"><img alt="Plex" src="https://img.shields.io/badge/Plex-supported-ffaa00.svg?logo=plex&logoColor=white"></a>
  <a href="#content-source-features"><img alt="Jellyfin" src="https://img.shields.io/badge/Jellyfin-supported-8f7ee7.svg?logo=jellyfin&logoColor=white"></a>
  <a href="#content-source-features"><img alt="TMDB" src="https://img.shields.io/badge/TMDB-supported-01d277.svg?logo=themoviedatabase&logoColor=white"></a>
  <a href="http://localhost:4000/api-docs"><img alt="OpenAPI Docs" src="https://img.shields.io/badge/OpenAPI-Docs-85EA2D.svg?logo=swagger&logoColor=white"></a>
</p>

<img src="./screenshots/screensaver.png" alt="Posterrama hero" width="740">

</div>

---

## What you can do with Posterrama

**Posterrama** transforms any screen into a dynamic, personal cinema experience. Use it as:

- A digital movie poster display — turn any TV or monitor into a cinematic foyer piece that continuously showcases your collection with studio‑grade artwork
- A digital movie wall for your living room, home theater, or office
- A smart, always-fresh screensaver with posters from your own collection
- A stylish showcase for your Plex or Jellyfin library
- A conversation starter or party display

---

## Features

### Screensaver mode

<figure>
  <img src="./screenshots/screensaver_2.png" alt="Screensaver Mode – Ken Burns and smooth fades" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>
    Screensaver Mode feels like a living poster wall—bold artwork gliding in and out, always fresh and cinematic.
  </em></figcaption>
  
</figure>

Turn any screen into a cinematic slideshow. Enjoy smooth, full-screen poster transitions from your own collection. Choose from multiple animation types (fade, slide, zoom, flip, and more) and set the interval for how often posters change. Perfect for ambiance, parties, or just showing off your taste.

**Key features:**

- Multiple animation types: fade, slide, zoom, flip, rotate, and more
- Adjustable transition speed and randomization
- Option to show movie/series info, ratings, and logos
- Works in both landscape and portrait orientation

### Wallart mode

<figure>
  <img src="./screenshots/wallart.png" alt="Wallart Grid" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Wallart Mode: multi-poster grid with smooth animations</em></figcaption>
  
</figure>

Display a beautiful grid of posters, updating dynamically with new content. Choose between a full grid or a hero+grid layout (one large featured poster with a 4x4 grid). Posters slide in smoothly, and you can choose between preset grid sizes.

**Key features:**

- 13+ animation styles for grid transitions
- Hero+Grid layout or full grid
- Customizable grid size and spacing

<figure>
  <img src="./screenshots/wallart_hero.png" alt="Wallart Hero + Grid" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Hero+Grid layout variant</em></figcaption>
  
</figure>

### Cinema mode

Perfect for vertical screens or digital signage. Show a rotating selection of posters in portrait orientation, with smooth transitions and optional info overlays. Ideal for hallway displays, kiosks, or a true cinema entrance feel.

**Key features:**

- Optimized for portrait/vertical screens
- Smooth poster transitions
- Optional info overlays and ratings

### Dashboard

<figure>
  <img src="./screenshots/dashboard.png" alt="Admin Dashboard" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>At‑a‑glance status, KPIs, recent activity, and quick actions</em></figcaption>
  
</figure>

Get a clear overview of your setup the moment you sign in. The Dashboard highlights system health, key metrics, recent events, connected devices, and quick links to common tasks — so you can spot issues and act fast.

<!-- Realtime preview moved into Display Settings as a bullet point -->

### Multiple content sources

<figure>
  <img src="./screenshots/media_sources.png" alt="Media Sources" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Connect your media sources easily</em></figcaption>
  
</figure>

Connect your Plex or Jellyfin server, or add popular sources like TMDB. Your collection is always up to date.

Local library: Add your own artwork with a simple upload—posters, cinematic backgrounds, motion posters, or complete posterpacks. You can also create shareable posterpacks directly from your Plex or Jellyfin libraries. New packs are picked up automatically—no unzipping or manual steps—and are instantly available in Screensaver, Wallart, and Cinema.

<!-- Content source features heading and intro removed per request; keep the actionable bullets below -->
 <!-- Content source features heading and intro removed per request; keep the actionable bullets below -->

- Enable/disable each source (Plex, Jellyfin, TMDB)
- Set server address and authentication (token, username/password)
- Choose which libraries or collections to include
- Filter by genre, rating, or quality

---

### Display Settings

<figure>
  <img src="./screenshots/display_settings.png" alt="Display Settings" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Fine-tune your display settings</em></figcaption>
  
</figure>

- Realtime preview — see changes instantly while you configure. Most settings hot‑reload without a restart; the display updates live as you tweak options.

### Device management (beta)

<figure>
  <img src="./screenshots/device_management.png" alt="Device Management" width="740">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Manage devices live: status, playback, and per‑device overrides</em></figcaption>
</figure>

Orchestrate every Posterrama screen from a single, real‑time dashboard. Device Management shows live status, lets you control playback, and apply per‑device Display Settings without interrupting the experience. Whether you run one TV at home or a whole foyer of screens, changes land instantly over a lightweight WebSocket channel.

What you can do:

- Live controls per device: previous/next, play/pause toggle, pin current poster, and reload/reset
- Clear status badges: Offline (grey), Online (green), Live (blue)
- Controls auto‑disable when a device is offline
- Per‑device Display Settings override with JSON editor and presets; apply live over WebSocket
- WebSocket heartbeat keeps status and playback state in sync with the device

Where it shines:

- At home — Quickly pause a screen when you get a call, pin a specific poster for a movie night, or tailor one display’s look (mode, grid density, info overlays) without touching the others.
- In commercial cinemas and venues — Keep foyer and hallway displays fresh and on‑brand. Swap promos in seconds, verify screens are healthy at a glance, and minimize downtime with one‑click reload/reset.

---

### Technical features

- Smart multi‑tier caching (memory + disk) with intelligent expiration
- Optimized image pipeline for fast loads and crisp 4K output
- Efficient WebSocket updates for live device control and instant settings apply
- Robust logging with compact Notification Center (filters, levels)
- Resilient configuration (/get-config) with schema validation and safe defaults
- API-first design with OpenAPI docs at /api-docs

## Roadmap

A quick peek at what's next. We're actively building these high‑impact upgrades to make Posterrama even more powerful and fun.

**Cinema & visual experience**

- [ ] Cinema mode: major expansion planned with many new features
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Trailer support

**Customization & design**

- [ ] Font/size/color customization

**Media sources & libraries**

- [ ] Emby integration
- [ ] Additional poster services
- [ ] Music library support
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

**Integrations & automation**

- [ ] Home Assistant support (MQTT) — publish device state and accept commands so displays can react to scenes, schedules, and smart‑home automations

**Content & curation**

- [ ] Online art galleries — browse and feature curated artwork streams alongside your library

And that's just the beginning — much more is on the way.

## System requirements

**Minimum recommended:**

- **RAM**: 2GB minimum, 4GB+ recommended for larger libraries (5000+ items)
- **Storage**: 2GB for application + cache space for images
- **OS**: Linux (Ubuntu, Debian, CentOS, RHEL), macOS, or Windows with Node.js support
- **Node.js**: v18 LTS or higher
- **Network**: Stable connection to media servers (Plex/Jellyfin)

**Performance notes:**

- Posterrama automatically uses up to 8GB heap memory for large libraries
- Image caching reduces bandwidth after initial load

## Get started

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

### Manual install (Debian-based distros)

```bash
# Install prerequisites (Debian/Ubuntu/Raspberry Pi OS)
sudo apt-get update
sudo apt-get install -y git curl build-essential

# Install Node.js (v18 LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v
npm -v

# Install Posterrama
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

## Configuration and usage

Go to http://your-posterrama-ip:4000/admin to:

Everything is managed through a clear dashboard—no coding required.

### Platform integration

#### Android TV

1. Install "Dashboard" screensaver from Google Play
2. Set as screensaver in Android TV settings
3. Configure: http://your-posterrama-ip:4000

---

## License

GPL-3.0-or-later – See [LICENSE](LICENSE) for details.
