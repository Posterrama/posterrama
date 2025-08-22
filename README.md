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

**Universal Compatibility**  
Works seamlessly with Plex, TMDB, TVDB, and streaming services across all devices.

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

## Media Sources

**Local Media**

- Plex Media Server

**External Sources**

- The Movie Database (TMDB)
- The TV Database (TVDB)
- Streaming Services (Netflix, Disney+, Prime Video, Apple TV+, HBO Max, Hulu, Paramount+, Crunchyroll)

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

## License

GPL-3.0-or-later

<div align="center">

[![Plex](https://img.shields.io/badge/Plex-Compatible-orange.svg)](https://www.plex.tv/)
[![TMDB](https://img.shields.io/badge/TMDB-Powered-blue.svg)](https://www.themoviedb.org/)
[![TVDB](https://img.shields.io/badge/TVDB-Powered-green.svg)](https://thetvdb.com/)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

</div>
