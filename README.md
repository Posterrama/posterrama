# Posterrama - Bring your media library to life

<div align="center">

[![Version](https://img.shields.io/badge/version-1.9.0-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-681%20tests%20in%2047%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

**Transform any screen into a stunning digital movie poster display**

<img src="./screenshots/screensaver.png" alt="Posterrama Cinema Display" width="750">

_Perfect for TV screensavers, wall-mounted tablets, or creating your own cinema lobby experience at home_

[![Plex](https://img.shields.io/badge/Plex-Compatible-orange.svg)](https://www.plex.tv/)
[![TMDB](https://img.shields.io/badge/TMDB-Powered-blue.svg)](https://www.themoviedb.org/)
[![TVDB](https://img.shields.io/badge/TVDB-Powered-green.svg)](https://thetvdb.com/)

</div>

---

## 🎭 Display Modes

<table>
<tr>
<td width="50%" align="center">

### 🖼️ **Cinema Mode**

**Professional digital movie poster display**

<img src="./screenshots/screensaver.png" alt="Cinema Mode - Single Poster Display" width="100%">

_Clean, cinema-quality presentation perfect for theaters and home displays_

</td>
<td width="50%" align="center">

### � **Wallart Mode**

**Multi-poster grid that fills your screen**

<img src="./screenshots/wallart.png" alt="Wallart Mode - Multi-Poster Grid" width="100%">

_Dynamic grid layout with intelligent screen-filling algorithm_

</td>
</tr>
</table>

---

## � Multi-Device Experience

<div align="center">
<table>
<tr>
<td align="center" width="33%">
<img src="./screenshots/mobile.png" alt="Mobile Optimized View" width="200"><br>
<strong>📱 Mobile Optimized</strong><br>
<em>Perfect layouts for phones & tablets</em>
</td>
<td align="center" width="33%">
<img src="./screenshots/admin.png" alt="Admin Dashboard" width="280"><br>
<strong>🛠️ Admin Dashboard</strong><br>
<em>Easy configuration & management</em>
</td>
<td align="center" width="33%">
<img src="./screenshots/screensaver.png" alt="TV Display" width="280"><br>
<strong>📺 TV Ready</strong><br>
<em>Optimized for big screens</em>
</td>
</tr>
</table>
</div>

---

## ✨ What Makes Posterrama Special?

Imagine walking into a movie theater and seeing those beautiful, professional movie posters displayed everywhere. Now imagine having that same cinematic experience in your home, automatically showcasing **your** favorite movies and shows!

<div align="center">

### 🎯 Perfect For Every Space

| 📺 **TV Screensavers** | 🖼️ **Wall Displays**  |   🏠 **Home Theaters**   |    📱 **Media Rooms**    |
| :--------------------: | :-------------------: | :----------------------: | :----------------------: |
| Transform idle TV time | Permanent digital art | Professional cinema feel | Showcase your collection |

</div>

### 🎨 Visual Magic Features

- **🎬 Cinema-Quality Backgrounds** - High-resolution movie artwork with smooth Ken Burns effects
- **🏷️ Movie Logos & Ratings** - Clean ClearLogo integration with Rotten Tomatoes scores
- **🕐 Smart Widgets** - Customizable clock and information overlays
- **📐 Responsive Design** - Looks amazing on any screen size
- **🎭 Dynamic Transitions** - Smooth animations between posters
- **🌈 Custom Themes** - Personalize colors and layouts

---

## 🌟 Coming Soon: Game-Changing Features

<div align="center">

### Get ready for an explosion of **cinema magic**! 🚀

</div>

<table>
<tr>
<td width="33%" align="center">

#### **🎭 Cinema Revolution**

- **Movie Trailers Integration**
- **Motion Posters**
- **Real-time Preview**
- **Advanced Animations**

</td>
<td width="33%" align="center">

#### **🔌 Universal Sources**

- **Emby & Jellyfin Support**
- **Kodi Integration**
- **Radarr/Sonarr/Lidarr**
- **Gaming Collections**

</td>
<td width="33%" align="center">

#### **🖥️ Multi-Display**

- **Multiple Screens**
- **Smart Sync**
- **Music Visualizations**
- **Gaming Libraries**

</td>
</tr>
</table>

---

## 🎮 Content Sources & Discovery

<div align="center">

### 📚 **Supported Media Sources**

</div>

<table>
<tr>
<td width="50%">

#### **🏠 Your Media Server**

- **Plex** - Full integration with your personal library
- Automatic discovery of movies and TV shows
- High-quality artwork and metadata
- Smart filtering and collections

#### **🌐 External Sources**

- **TMDB** - Rich movie and TV information
- **TVDB** - Comprehensive TV series database
- **Streaming Providers** - Netflix, Disney+, Prime, Apple TV+, HBO Max, Hulu, Paramount+, Crunchyroll

</td>
<td width="50%">

#### **🎯 Smart Features**

- **Advanced Filtering** - By rating, genre, release date
- **Automatic Enrichment** - Enhanced artwork and metadata
- **Curated Collections** - Trending and new releases
- **Global Regions** - 49+ countries supported
- **Professional Quality** - Cinema-grade posters and backdrops

</td>
</tr>
</table>

---

## � Quick Installation

<div align="center">

### **One command installs everything!**

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

<img src="./screenshots/admin.png" alt="Installation Process" width="500">

_Automated setup in under 2 minutes on Ubuntu, Debian, CentOS, RHEL, Rocky Linux, AlmaLinux, Fedora_

</div>

### ✅ **What the installer does:**

<table>
<tr>
<td width="50%">

- ✅ **Install Node.js 18+** and dependencies
- ✅ **Create system user** for security
- ✅ **Download & setup** Posterrama
- ✅ **Configure PM2** process manager

</td>
<td width="50%">

- ✅ **Setup systemd service** for auto-start
- ✅ **Configure firewall** (if available)
- ✅ **Provide next steps** for configuration
- ✅ **Test installation** and connectivity

</td>
</tr>
</table>

---

## 📋 Manual Installation

<details>
<summary><strong>🔧 Click here for manual installation steps</strong></summary>

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

---

## 📺 Platform Integration

<table>
<tr>
<td width="50%">

### **🤖 Android TV**

Turn your Android TV into a movie poster screensaver:

1. Install **"Dashboard"** screensaver from Google Play
2. Set as screensaver in Android TV settings
3. Configure: `http://your-posterrama-ip:4000`
4. Enjoy automatic movie posters when idle!

</td>
<td width="50%">

### **🍎 Apple TV**

Multiple ways to enjoy Posterrama:

**AirPlay Display:**

- Open in Safari on iPhone/iPad
- Use AirPlay to mirror to Apple TV
- Enable "Guided Access" to prevent exits

**Browser Apps:**

- Install "Web Browser for Apple TV"
- Navigate to your Posterrama URL

</td>
</tr>
</table>

---

## 🎮 How to Use

<div align="center">

### **🖥️ Main Display**

Visit `http://your-server-ip:4000` for your beautiful movie poster screensaver

### **⚙️ Admin Panel**

Visit `http://your-server-ip:4000/admin` to configure everything

</div>

<table>
<tr>
<td width="25%" align="center">
<strong>🔗 Connect</strong><br>
Link your media servers
</td>
<td width="25%" align="center">
<strong>📚 Select</strong><br>
Choose libraries to display
</td>
<td width="25%" align="center">
<strong>🎨 Customize</strong><br>
Adjust visual settings
</td>
<td width="25%" align="center">
<strong>📊 Monitor</strong><br>
Track system health
</td>
</tr>
</table>

---

## 💡 Pro Tips

<div align="center">

|   🎯 **Best Results**    |    🖥️ **Performance**    | 🏠 **Multiple Displays** |      ⚙️ **Customization**       |
| :----------------------: | :----------------------: | :----------------------: | :-----------------------------: |
| Use high-quality artwork | Great on Raspberry Pi 4+ |  Run multiple instances  | Admin panel controls everything |

</div>

---

## 📜 License & Support

<div align="center">

This project is **free and open source** under the GPL-3.0-or-later license.

[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?logo=github)](https://github.com/Posterrama/posterrama)
[![Issues](https://img.shields.io/badge/Issues-Report%20Bug-red?logo=github)](https://github.com/Posterrama/posterrama/issues)
[![Discussions](https://img.shields.io/badge/Discussions-Community-blue?logo=github)](https://github.com/Posterrama/posterrama/discussions)

**Ready to transform your space into a personal cinema?**

_Posterrama - Because your movie collection deserves to be seen!_ ✨

</div>
