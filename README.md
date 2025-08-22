# Posterrama

Transform any screen into a stunning digital movie poster display.

<div align="center">

<img src="./screenshots/screensaver.png" alt="Posterrama Cinema Display" width="600">

[![Version](https://img.shields.io/badge/version-1.9.0-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-681%20tests%20in%2047%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing)

</div>

## Features

**Cinema Mode**  
Professional digital movie poster display with high-quality artwork and smooth transitions.

**Wallart Mode**  
Multi-poster grid that intelligently fills your screen with dynamic layouts.

**Smart Caching**  
Advanced image caching system with automatic cleanup and optimization for faster loading.

**Universal Compatibility**  
Works seamlessly with Plex, TMDB, TVDB, and streaming services across all devices.

**Admin Dashboard**  
Comprehensive web interface for managing sources, display settings, and monitoring system health.

**Real-time Updates**  
Automatic synchronization with your media servers for the latest posters and metadata.

**Responsive Design**  
Optimized layouts for every screen size from mobile phones to 4K displays.

**API Integration**  
RESTful API with OpenAPI documentation for custom integrations and automation.

<div align="center">

<img src="./screenshots/screensaver.png" alt="Cinema Mode" width="45%">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/wallart.png" alt="Wallart Mode" width="45%">

<br>
<strong>Cinema Mode</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>Wallart Mode</strong>

</div>

## Installation

Install with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

Or install manually:

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm install -g pm2
pm2 start ecosystem.config.js
```

## Setup

1. Open `http://your-server-ip:4000/admin/setup`
2. Create your admin account
3. Connect your media sources
4. Configure display settings
5. Visit `http://your-server-ip:4000` to view your display

## API Documentation

Posterrama includes a comprehensive REST API with OpenAPI documentation:

- **API Docs**: `http://your-server-ip:4000/api-docs`
- **Health Check**: `http://your-server-ip:4000/health`
- **Admin API**: `http://your-server-ip:4000/admin/api`

**Example API Usage**

```bash
# Get all posters
curl http://your-server-ip:4000/api/posters

# Get poster by ID
curl http://your-server-ip:4000/api/posters/{id}

# Refresh media sources
curl -X POST http://your-server-ip:4000/api/refresh
```

## Media Sources

**Local Media Servers**

- Plex Media Server (Full integration with metadata)
- Jellyfin (Basic support)
- Emby (Basic support)

**Online Databases**

- The Movie Database (TMDB) - Movies and TV shows
- The TV Database (TVDB) - Enhanced TV metadata
- Fanart.tv - High-quality artwork

**Streaming Platforms**

- Netflix, Disney+, Prime Video, Apple TV+
- HBO Max, Hulu, Paramount+, Crunchyroll
- And many more through TMDB integration

**Custom Sources**

- Local folder scanning
- Custom API endpoints
- Manual poster uploads

## Platform Support

**TV Integration**

- Android TV with Dashboard screensaver
- Apple TV via AirPlay or browser apps

**Device Compatibility**

- Raspberry Pi 4+
- Any device with Node.js 18+
- Optimized for mobile, tablet, and desktop

<div align="center">

<img src="./screenshots/mobile.png" alt="Mobile" width="150">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/admin.png" alt="Admin" width="200">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/screensaver.png" alt="TV" width="200">

<br>
<strong>Mobile</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>Admin</strong>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<strong>TV</strong>

</div>

## Requirements

- Node.js 18 or later
- A media server (Plex recommended)
- 5 minutes for setup

## Updates

To update Posterrama to the latest version:

```bash
# Update as the posterrama user to maintain correct file ownership
sudo -u posterrama git pull

# Or if you need to update as root, fix ownership afterwards
git pull && chown -R posterrama:posterrama /var/www/posterrama

# Restart the service
pm2 restart posterrama
```

## Coming Soon

**Enhanced Display Modes**

- Slideshow mode with customizable transitions
- Seasonal themes and collections
- Dynamic lighting integration

**Advanced Media Support**

- 4K poster optimization
- Video trailer integration
- Music album artwork support

**Smart Features**

- AI-powered poster recommendations
- Automatic genre-based collections
- Voice control integration

## Troubleshooting

**Service not starting?**

```bash
pm2 logs posterrama
```

**Images not loading?**
Check your media source configuration in the admin panel.

**Permission issues after git pull?**

```bash
sudo chown -R posterrama:posterrama /var/www/posterrama
```

## License

GPL-3.0-or-later

<div align="center">

[![Plex](https://img.shields.io/badge/Plex-Compatible-orange.svg)](https://www.plex.tv/)
[![TMDB](https://img.shields.io/badge/TMDB-Powered-blue.svg)](https://www.themoviedb.org/)
[![TVDB](https://img.shields.io/badge/TVDB-Powered-green.svg)](https://thetvdb.com/)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

</div>
