# Posterrama - Bring your media library to life

[![Version](https://img.shields.io/badge/version-1.8.8-blue.svg)](https://github.com/Posterrama/posterrama)
[![Downloads](https://img.shields.io/github/downloads/Posterrama/posterrama/total?style=flat&logo=github&label=Downloads&color=brightgreen)](https://github.com/Posterrama/posterrama/releases)
[![Tests](https://img.shields.io/badge/tests-615%20tests%20in%2043%20suites-brightgreen)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-87.75%25-brightgreen)](#testing)
[![Node.js](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)
[![Plex](https://img.shields.io/badge/Plex-Compatible-orange.svg)](https://www.plex.tv/)
[![TMDB](https://img.shields.io/badge/TMDB-Powered-blue.svg)](https://www.themoviedb.org/)
[![TVDB](https://img.shields.io/badge/TVDB-Powered-green.svg)](https://thetvdb.com/)

Transform any screen into a **stunning digital movie poster display** that showcases your personal media collection! Perfect for TV screensavers, wall-mounted tablets, or creating your own cinema lobby experience at home.

![Screenshot of screensaver](./screenshots/screensaver.png)

### 🌟 **Coming Soon: Game-Changing Features**

Get ready for an explosion of **cinema magic**:

#### **🎭 Cinema Mode Revolution**

- **Movie Trailers Integration** - Watch trailers directly in your poster displays
- **Motion Posters** - Animated movie artwork that brings posters to life
- **Real-time Preview** - See your changes instantly as you configure settings
- **Advanced Animations** - Stunning transitions and cinematic effects

#### **🔌 Universal Content Sources**

- **Emby & Jellyfin Support** - Connect to any media server you love
- **Kodi Integration** - Seamless integration with your existing setup
- **Radarr, Sonarr & Lidarr** - Rich metadata from your \*arr stack
- **Multi-Content Types** - Movies, TV shows, music, and gaming collections

#### **🖥️ Multi-Display Ecosystem**

- **Multiple Screens** - Manage different displays with unique configurations
- **Gaming Collections** - Showcase your Steam, PlayStation, Xbox libraries
- **Music Visualizations** - Album art displays for your music collection
- **Smart Sync** - Coordinated displays across your entire home

## ✨ What Makes Posterrama Special?

Imagine walking into a movie theater and seeing those beautiful, professional movie posters displayed everywhere. Now imagine having that same cinematic experience in your home, automatically showcasing **your** favorite movies and shows!

### Perfect For:

- **TV Screensavers** - Transform your TV into a cinema display when not in use
- **Wall-Mounted Tablets** - Create permanent digital movie posters for any room
- **Home Theater Lobbies** - Professional cinema experience in your own space
- **Media Room Displays** - Show off your collection in style

### Visual Magic

- **Cinema-Quality Backgrounds** - High-resolution movie artwork with smooth Ken Burns effects
- **Movie Logos & Ratings** - Clean ClearLogo integration with Rotten Tomatoes scores
- **Smart Widgets** - Customizable clock and information overlays
- **Responsive Design** - Looks amazing on any screen size

![Wallart mode showcase](./screenshots/wallart.png)

![Screenshot of admin](./screenshots/admin.png)

## ✨ Cool Features That Make It Awesome

### 🎭 Media Server Magic

Connect to your **Plex** server and watch as Posterrama automatically:

- Discovers all your movies and TV shows
- Downloads beautiful backdrop images and movie posters
- Shows ratings, release years, and movie taglines
- Cycles through your collection with smooth transitions

### Content Sources & Discovery

Posterrama connects to multiple sources to bring your media library to life:

**Supported Media Servers:**

- **Plex** - Your personal media server

**Enhanced Metadata Sources:**

- **TMDB** - Rich movie and TV show information
- **TVDB** - Comprehensive TV series database

**Smart Features:**

- Advanced filtering by rating, genre, and release date
- Automatic artwork and metadata enrichment
- Curated collections and trending content
- Professional movie posters and backdrops
  Posterrama connects to **The Movie Database (TMDB)** for enhanced content discovery:
- **Curated Collections** - Browse "New Releases" and trending content
- **Global Streaming Providers** - Support for Netflix, Disney+, Prime Video, Apple TV+, Max (HBO), Hulu, Paramount+, and Crunchyroll
- **Worldwide Regions** - Choose from 49+ countries to see region-specific content
- **Smart Filtering** - Customize by rating, genre, and streaming availability
- **Rich Metadata** - Complete movie descriptions, cast info, and detailed ratings

### 📱 Responsive Design

Posterrama works perfectly on any device:

- **Mobile Layout** - Optimized poster and metadata positioning for phones
- **Desktop Experience** - Full descriptions with proper text wrapping
- **TV Optimization** - Clean, readable layouts for large screens
- **Smart Text Display** - Titles and ratings always visible, descriptions intelligently managed

<img src="./screenshots/mobile.png" alt="Mobile responsive design" width="300">

### Android TV Integration

Turn your **Android TV** into a movie poster screensaver using the **Dashboard** screensaver app:

1. Install "Dashboard" screensaver from Google Play Store
2. Set it as your screensaver in Android TV settings
3. Configure Dashboard to display Posterrama: `http://your-posterrama-ip:4000`
4. Enjoy automatic movie posters when your TV is idle!

### Apple TV Setup

While Apple TV doesn't support custom screensavers directly, you can still enjoy Posterrama:

**Option 1: AirPlay Display**

- Open Posterrama in Safari on your iPhone/iPad
- Use AirPlay to mirror to your Apple TV
- Enable "Guided Access" to prevent accidental exits

**Option 2: Apple TV Browser Apps**

- Install a browser app like "Web Browser for Apple TV"
- Navigate to your Posterrama URL: `http://your-posterrama-ip:4000`
- Use it as a manual screensaver when desired

## 🛠️ Easy Installation

### What You'll Need

- **Node.js 18+** (the engine that runs Posterrama)
    - Download from [nodejs.org](https://nodejs.org/) - choose the LTS version
    - This is like installing a program that lets Posterrama run on your computer
- **A Media Server** (Plex)
    - Your existing Plex server with movies and TV shows
- **5 minutes** of your time!

### Quick Start Guide

1. **Get the Code**

    ```bash
    git clone https://github.com/Posterrama/posterrama.git
    cd posterrama
    ```

2. **Install Everything**

    ```bash
    npm install
    npm install -g pm2
    ```

3. **Start It Up!**

    ```bash
    pm2 start ecosystem.config.js
    ```

4. **Configuration Setup**
    - On first run, Posterrama automatically creates `config.json` from `config.example.json`
    - Your personal `config.json` is **not** tracked in Git, so your settings stay private
    - Safe to pull updates without losing your configuration!

5. **Complete Setup Through Web Interface**
    - Open `http://your-server-ip:4000/admin/setup`
    - Create your admin account (don't forget to enable 2FA!)
    - Connect your media servers (Plex, TMDB, etc.)
    - Select which movie/TV libraries to display
    - Customize your display settings

## 🎮 How to Use

### Main Display

Visit `http://your-server-ip:4000` to see your beautiful movie poster screensaver in action!

### Admin Panel

Visit `http://your-server-ip:4000/admin` to:

- Connect your media servers
- Choose which libraries to display
- Customize visual settings
- Monitor system health

## 💡 Pro Tips

- **For best results**: Use high-quality movie artwork in your media server
- **Performance**: Posterrama works great on Raspberry Pi 4+ for dedicated displays
- **Multiple displays**: Run multiple Posterrama instances for different rooms
- **Customize everything**: The admin panel lets you tweak colors, timing, and display options

## 📜 License

This project is **free and open source** under the GPL-3.0-or-later license. You can use it, modify it, and share it - just keep it open source too!

---

**Ready to transform your space into a personal cinema?**

_Posterrama - Because your movie collection deserves to be seen!_

---

## 👩‍💻 Development & Contributing

### 🛠️ Development Setup

```bash
# Clone and setup
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install

# Run development checks
npm run health              # Project health check
npm run review:pre-check   # Pre-review checklist
npm test                   # Run all tests
npm run lint              # Check code quality
npm run format            # Format code
```

### 📋 Code Review Process

We maintain high code quality standards through comprehensive reviews:

#### 📚 **Review Documentation**

- **[Master Guide](./docs/CODE-REVIEW-MASTER-GUIDE.md)** - Complete overview
- **[Detailed Checklist](./docs/CODE-REVIEW-CHECKLIST.md)** - What to look for
- **[Quick Reference](./docs/CODE-REVIEW-QUICK-REF.md)** - 30-second checklist
- **[Tech-Specific](./docs/TECH-SPECIFIC-REVIEW.md)** - JavaScript/Node.js/React tips

#### 🔍 **Review Focus Areas**

- **Security**: Input validation, SQL injection prevention, XSS protection
- **Performance**: Efficient algorithms, memory management, caching
- **Testing**: Unit tests, integration tests, edge case coverage
- **Architecture**: Clean code, SOLID principles, maintainability

#### 🚀 **Before Submitting PRs**

```bash
npm run review:pre-check   # Automated pre-review checks
```

#### ✅ **Review Approval Criteria**

- All automated checks pass (linting, formatting, tests, security)
- Code follows team standards and best practices
- Proper error handling and input validation
- Good test coverage for new functionality
- Clear and maintainable code structure

### 🔒 Security & Dependencies

- **Accepted Risks**: Plex API vulnerabilities (documented in [SECURITY-ACCEPTED-RISKS.md](./docs/SECURITY-ACCEPTED-RISKS.md))
- **Dependency Management**: See [DEPENDENCY-MANAGEMENT.md](./docs/DEPENDENCY-MANAGEMENT.md)
- **Security Audits**: Filtered to exclude accepted risks

### 📊 Testing

```bash
npm test                 # Run all 615 tests in 43 suites
npm run test:coverage   # Generate coverage report (87.75%)
npm run test:watch      # Run tests in watch mode
```

### 🔧 Code Quality Tools

- **ESLint**: Code linting and style enforcement
- **Prettier**: Consistent code formatting
- **Jest**: Unit and integration testing
- **Security Audit**: Dependency vulnerability scanning
- **Pre-commit Hooks**: Automatic formatting and linting

### 📖 Additional Documentation

- **[Safe Library Updates](./docs/SAFE-LIBRARY-UPDATES.md)**
- **[Pre-commit Hook Setup](./docs/PRE-COMMIT-HOOK.md)**
- **[Branch Protection Guide](./scripts/setup-branch-protection.sh)**

### 🤝 Contributing Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with proper tests
4. Run pre-review checks (`npm run review:pre-check`)
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request with clear description

**Quality Standards**: All PRs must pass automated checks and code review before merging.
