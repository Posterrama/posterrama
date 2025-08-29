# Posterrama - Bring your media library to life.

Transform any screen into a cinematic, always-fresh movie poster display.

<div align="center">

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/Posterrama/posterrama) [![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases) [![Tests](https://img.shields.io/badge/tests-949%20tests%20in%2061%20suites-brightgreen)](#testing) [![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing) [![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/) [![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

<p style="margin: 6px 0 0 0;">
  <a href="https://www.plex.tv/"><img alt="Plex" src="https://img.shields.io/badge/Plex-Supported-E5A00D?logo=plex&logoColor=white"></a>
  <a href="https://jellyfin.org/"><img alt="Jellyfin" src="https://img.shields.io/badge/Jellyfin-Supported-00A4DC?logo=jellyfin&logoColor=white"></a>
  <a href="https://www.themoviedb.org/"><img alt="TMDB" src="https://img.shields.io/badge/TMDB-Integrated-01D277?logo=tmdb&logoColor=white"></a>
  <a href="https://thetvdb.com/"><img alt="TVDB" src="https://img.shields.io/badge/TVDB-Integrated-0285FF?logo=thetvdb&logoColor=white"></a>
  <img alt="OpenAPI Docs" src="https://img.shields.io/badge/Docs-Swagger_/_OpenAPI-6BA539?logo=swagger&logoColor=white">

</p>

<img src="./screenshots/screensaver.png" alt="Posterrama hero" width="740">

 </div>

---

## 🌟 What can you do with Posterrama?

**Posterrama** transforms any screen into a dynamic, personal cinema experience. Use it as:

- A digital movie wall for your living room, home theater, or office
- A smart, always-fresh screensaver with posters from your own collection
- A stylish showcase for your Plex or Jellyfin library
- A conversation starter or party display

---

## ✨ Features

### 🎬 Screensaver Mode

Turn any screen into a cinematic slideshow. Enjoy smooth, full-screen poster transitions from your own collection. Choose from multiple animation types (fade, slide, zoom, flip, and more) and set the interval for how often posters change. Perfect for ambiance, parties, or just showing off your taste.

**Key features:**

- Multiple animation types: fade, slide, zoom, flip, rotate, and more
- Adjustable transition speed and randomization
- Option to show movie/series info, ratings, and logos
- Works in both landscape and portrait orientation

### 🖼️ Wallart Mode

<figure>
  <img src="./screenshots/wallart.png" alt="Wallart Grid" width="420">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Wallart Mode: multi-poster grid with smooth animations</em></figcaption>
  
</figure>

Display a beautiful grid of posters, updating dynamically with new content. Choose between a full grid or a hero+grid layout (one large featured poster with a 4x4 grid). Each poster can animate in with its own style, and you can customize the number of rows/columns.

**Key features:**

- 13+ animation styles for grid transitions
- Hero+Grid layout or full grid
- Customizable grid size and spacing
- Option to show/hide metadata, ratings, and logos

<figure>
  <img src="./screenshots/wallart_hero.png" alt="Wallart Hero + Grid" width="420">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Hero+Grid layout variant</em></figcaption>
  
</figure>

### 🏛️ Cinema Mode

Perfect for vertical screens or digital signage. Show a rotating selection of posters in portrait orientation, with smooth transitions and optional info overlays. Ideal for hallway displays, kiosks, or a true cinema entrance feel.

**Key features:**

- Optimized for portrait/vertical screens
- Smooth poster transitions
- Optional info overlays and ratings

### 📱 Mobile Admin & Responsive Design

<div align="center" style="margin: 8px 0;">
  <img src="./screenshots/admin_1.jpg" alt="Admin UI 1" height="240" style="margin: 0 8px; vertical-align: bottom;" />
  <img src="./screenshots/admin_2.jpg" alt="Admin UI 2" height="240" style="margin: 0 8px; vertical-align: bottom;" />
  <img src="./screenshots/admin_3.jpg" alt="Admin UI 3" height="240" style="margin: 0 8px; vertical-align: bottom;" />
  
</div>

Configure everything from your phone, tablet, or desktop. The admin dashboard is fully responsive and works on any device.

### ⚡ Realtime Preview

See changes instantly while you configure. Most settings hot‑reload without a restart; the display updates in real time as you tweak options in the admin.

### ⚡ Blazing Fast Caching & Optimization

Images are loaded instantly thanks to smart caching and optimization. Posters always look sharp, even on 4K displays.

### 🔗 Multiple Content Sources

<figure>
  <img src="./screenshots/admin_sources.png" alt="Admin Sources" width="420">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Connect your media sources easily</em></figcaption>
  
</figure>

Connect your Plex or Jellyfin server, or add popular sources like TMDB and TVDB. Your collection is always up to date.

---

## 🔧 Content Source Features

In the admin dashboard, you can configure for each source:

- Enable/disable each source (Plex, Jellyfin, TMDB, TVDB)
- Set server address and authentication (token, username/password)
- Choose which libraries or collections to include
- Filter by genre, year, rating, or watched/unwatched status
- Enable/disable specific genres

---

<figure>
  <img src="./screenshots/admin_display.png" alt="Admin Display Settings" width="420">
  <figcaption style="text-align:left; color:#6a6a6a;"><em>Fine-tune your display settings</em></figcaption>
  
</figure>

---

## 🔊 Coming Soon — turn it up to eleven

A quick peek at what’s next. We’re actively building these high‑impact upgrades to make Posterrama even more powerful and fun.

### Media Sources

- [ ] Local photo directory support
- [ ] Emby integration
- [ ] Additional poster services
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

### UI/UX Improvements

- [ ] Cinema mode: major expansion planned with many new features
- [ ] Advanced transition effects
- [ ] Font/size/color customization
- [ ] Trailer support
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Multiple screens with smart sync and coordinated displays
- [ ] Remote on/off via API
- [ ] Music library support

And that’s just the beginning — much more is on the way.

## 🚀 Get Started Instantly

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

## 🛠️ Configuration & Usage

Go to [http://localhost:4000/admin](http://localhost:4000/admin) to:

- Connect your Plex, Jellyfin, or both
- Choose your favorite display mode (Screensaver, Wallart, Cinema)
- Customize transitions, animations, and scaling
- Show or hide logos, ratings, and metadata
  Everything is managed through a clear dashboard—no coding required.

### 📺 Platform Integration

#### Android TV

1. Install "Dashboard" screensaver from Google Play
2. Set as screensaver in Android TV settings
3. Configure: http://your-posterrama-ip:4000

---

## 📄 License

GPL-3.0-or-later – See [LICENSE](LICENSE) for details.
