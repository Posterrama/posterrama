# Posterrama - Bring your media library to life.

Transform any screen into a stunning digital movie poster display.

<div align="center">

[![Version](https://img.shields.io/badge/version-1.9.0-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-681%20tests%20in%2047%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

<img src="./screenshots/screensaver.png" alt="Posterrama Cinema Display" width="750">

Perfect for TV screensavers, wall-mounted tablets, or creating your own cinema lobby experience at home.

[![Plex](https://img.shields.io/badge/Plex-Compatible-orange.svg)](https://www.plex.tv/)
[![TMDB](https://img.shields.io/badge/TMDB-Powered-blue.svg)](https://www.themoviedb.org/)
[![TVDB](https://img.shields.io/badge/TVDB-Powered-green.svg)](https://thetvdb.com/)

</div>

## Display Modes

<div align="center">

<img src="./screenshots/screensaver.png" alt="Screensaver Mode" width="45%">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/wallart.png" alt="Wallart Mode" width="45%">

</div>

<div style="display: flex; justify-content: space-between; max-width: 100%;">
<div style="width: 45%;">
<strong>Screensaver Mode</strong>
</div>
<div style="width: 45%;">
<strong>Wallart Mode</strong>
</div>
</div>

**Screensaver Mode**  
Professional digital movie poster display with clean, cinema-quality presentation perfect for theaters and home displays.

**Wallart Mode**  
Multi-poster grid that fills your screen with dynamic grid layout and intelligent screen-filling algorithm.

## Multi-Device Experience

<div align="center">

<img src="./screenshots/mobile.png" alt="Mobile" width="150">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/admin.png" alt="Admin" width="200">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./screenshots/screensaver.png" alt="TV" width="200">

</div>

<div style="display: flex; justify-content: space-between; max-width: 100%;">
<div style="width: 150px;">
<strong>Mobile</strong>
</div>
<div style="width: 200px; margin-left: 50px;">
<strong>Admin</strong>
</div>
<div style="width: 200px; margin-left: 50px;">
<strong>TV</strong>
</div>
</div>

**Mobile Optimized**  
Perfect layouts for phones and tablets with responsive design.

**Admin Dashboard**  
Easy configuration and management through comprehensive web interface.

**TV Ready**  
Optimized for big screens with professional display quality.

## What Makes Posterrama Special?

Imagine walking into a movie theater and seeing those beautiful, professional movie posters displayed everywhere. Now imagine having that same cinematic experience in your home, automatically showcasing **your** favorite movies and shows!

### Perfect For Every Space

**TV Screensavers** - Transform idle TV time into beautiful displays  
**Wall Displays** - Permanent digital art for any room  
**Home Theaters** - Professional cinema feel at home  
**Media Rooms** - Showcase your collection with style

### Visual Features

- **Cinema-Quality Backgrounds** - High-resolution movie artwork with smooth Ken Burns effects
- **Movie Logos & Ratings** - Clean ClearLogo integration with Rotten Tomatoes scores
- **Smart Widgets** - Customizable clock and information overlays
- **Responsive Design** - Looks amazing on any screen size
- **Dynamic Transitions** - Smooth animations between posters
- **Custom Themes** - Personalize colors and layouts

## Coming Soon

Get ready for an explosion of cinema magic!

**Cinema Revolution**

- Movie Trailers Integration
- Motion Posters
- Real-time Preview
- Advanced Animations

**Universal Sources**

- Emby & Jellyfin Support
- Kodi Integration
- Radarr/Sonarr/Lidarr
- Gaming Collections

**Multi-Display**

- Multiple Screens
- Smart Sync
- Music Visualizations
- Gaming Libraries

## Content Sources & Discovery

### Supported Media Sources

**Your Media Server**

- **Plex** - Full integration with your personal library
- Automatic discovery of movies and TV shows
- High-quality artwork and metadata
- Smart filtering and collections

**External Sources**

- **TMDB** - Rich movie and TV information
- **TVDB** - Comprehensive TV series database
- **Streaming Providers** - Netflix, Disney+, Prime, Apple TV+, HBO Max, Hulu, Paramount+, Crunchyroll

**Smart Features**

- **Advanced Filtering** - By rating, genre, release date
- **Automatic Enrichment** - Enhanced artwork and metadata
- **Curated Collections** - Trending and new releases
- **Global Regions** - 49+ countries supported
- **Professional Quality** - Cinema-grade posters and backdrops

## Quick Installation

### One command installs everything!

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

<div align="center">
<img src="./screenshots/admin.png" alt="Installation Process" width="500">
</div>

Automated setup in under 2 minutes on Ubuntu, Debian, CentOS, RHEL, Rocky Linux, AlmaLinux, Fedora.

### What the installer does:

**System Setup**

- Install Node.js 18+ and dependencies
- Create system user for security
- Download & setup Posterrama
- Configure PM2 process manager

**Service Configuration**

- Setup systemd service for auto-start
- Configure firewall (if available)
- Provide next steps for configuration
- Test installation and connectivity

## Manual Installation

<details>
<summary><strong>Click here for manual installation steps</strong></summary>

### What You'll Need

- **Node.js 18+** - [Download from nodejs.org](https://nodejs.org/) (LTS version)
- **A Media Server** - Your existing Plex server with movies and TV shows
- **5 minutes** of your time!

### Quick Start Guide

1. **Get the Code**

    ```bash
    git clone https://github.com/Posterrama/posterrama.git
    cd posterrama
    ```

2. **Install Dependencies**

    ```bash
    npm install
    npm install -g pm2
    ```

3. **Start the Application**

    ```bash
    pm2 start ecosystem.config.js
    ```

4. **Complete Setup**
    - Open `http://your-server-ip:4000/admin/setup`
    - Create your admin account (enable 2FA!)
    - Connect your media servers
    - Customize display settings

</details>

## Platform Integration

### Android TV

Turn your Android TV into a movie poster screensaver:

1. Install **"Dashboard"** screensaver from Google Play
2. Set as screensaver in Android TV settings
3. Configure: `http://your-posterrama-ip:4000`
4. Enjoy automatic movie posters when idle!

### Apple TV

Multiple ways to enjoy Posterrama:

**AirPlay Display:**

- Open in Safari on iPhone/iPad
- Use AirPlay to mirror to Apple TV
- Enable "Guided Access" to prevent exits

**Browser Apps:**

- Install "Web Browser for Apple TV"
- Navigate to your Posterrama URL

## How to Use

### Main Display

Visit `http://your-server-ip:4000` for your beautiful movie poster screensaver

### Admin Panel

Visit `http://your-server-ip:4000/admin` to configure everything

**Connect** - Link your media servers  
**Select** - Choose libraries to display  
**Customize** - Adjust visual settings  
**Monitor** - Track system health

## Pro Tips

**Best Results** - Use high-quality artwork for optimal display  
**Performance** - Great on Raspberry Pi 4+ and similar devices  
**Multiple Displays** - Run multiple instances for different rooms  
**Customization** - Admin panel controls everything you need

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

## License & Support

This project is **free and open source** under the GPL-3.0-or-later license.

[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?logo=github)](https://github.com/Posterrama/posterrama)
[![Issues](https://img.shields.io/badge/Issues-Report%20Bug-red?logo=github)](https://github.com/Posterrama/posterrama/issues)
[![Discussions](https://img.shields.io/badge/Discussions-Community-blue?logo=github)](https://github.com/Posterrama/posterrama/discussions)

Ready to transform your space into a personal cinema?

_Posterrama - Because your movie collection deserves to be seen!_
