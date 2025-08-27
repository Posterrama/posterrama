# Posterrama - Bring your media library to life.

Transform any screen into a cinematic, always-fresh movie poster display.

<div align="center">

[![Version](https://img.shields.io/badge/version-1.9.5-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-681%20tests%20in%2047%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.53%25-brightgreen)](#testing)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

<img src="./screenshots/screensaver.png" alt="Posterrama hero" width="740">

</div>

---

## ✨ Features

- **🎬 Screensaver Mode** - Smooth, cinema-quality poster transitions
- **🖼️ Wallart Mode** - Multi-poster grid with advanced animations
- **🎯 Hero+Grid Layout** - Featured content with intelligent 4x4 grid
- **📱 Responsive Design** - Works on phones, tablets, TVs, and 4K displays
- **🔗 Multiple Sources** - Plex, Jellyfin, TMDB, TVDB support
- **⚡ Smart Caching** - Lightning-fast image optimization
- **🎨 Advanced UI** - Scaling controls and customizable display settings

---

## 🚀 Quick Start

**One-line install:**

```bash
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

**Manual install:**

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm install -g pm2
pm2 start ecosystem.config.js
```

**Access:** Open `http://localhost:4000` in your browser

---

## 📖 Content & Discovery

### Media Servers

- **Plex Media Server** - Full integration with library discovery
- **Jellyfin** - Open-source media server support
- **TMDB (The Movie Database)** - Trending movies and TV shows
- **TVDB** - Comprehensive TV series database

### Display Modes

- **Screensaver** - Single poster with smooth transitions
- **Wallart** - Multi-poster grid with 13 animation types
- **Cinema** - Portrait orientation for digital movie posters

---

## ⚙️ Configuration

Access the admin dashboard at `http://localhost:4000/admin` to configure:

- **Media Sources** - Connect your Plex/Jellyfin servers
- **Display Settings** - Customize transitions and animations
- **Visual Elements** - Toggle logos, ratings, metadata
- **UI Scaling** - Adjust interface size for different screens

---

## 🧪 Testing

```bash
npm test                    # Run all tests (681 tests)
npm test -- --watch        # Watch mode
npm test sources           # Test media source integrations
```

**Coverage:** 87.53% across 47 test suites

---

## 📚 Documentation

- [**Contributing Guide**](docs/CONTRIBUTING.md) - Development setup and code review
- [**Development Guide**](docs/DEVELOPMENT.md) - Technical documentation and API
- [**Installation Guide**](docs/INSTALLATION.md) - Detailed setup instructions

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/CONTRIBUTING.md) for:

- Development setup
- Code review guidelines
- Testing requirements
- Best practices

---

## 📄 License

GPL-3.0-or-later - See [LICENSE](LICENSE) for details.

---

<div align="center">

**Made with ❤️ for movie lovers everywhere**

[⭐ Star us on GitHub](https://github.com/Posterrama/posterrama) | [📝 Report Issues](https://github.com/Posterrama/posterrama/issues) | [💬 Discussions](https://github.com/Posterrama/posterrama/discussions)

</div>
