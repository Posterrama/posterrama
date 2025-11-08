# Plex Music Wallart Display Specification

**Part of:** Plex Music Implementation Plan  
**Phase:** 5 - Wallart Music Mode Frontend

---

## Overview

This document specifies the frontend implementation for Wallart Music Mode, including layout algorithms, display styles, animations, and responsive design.

---

## Display Styles Implementation

### Style 1: Album Covers Only

**Visual Design:**

```
┌───────────────────────────────────────────┐
│ ┌─────┬─────┬─────┬─────┐                │
│ │ 🎵  │ 🎵  │ 🎵  │ 🎵  │                │
│ │Album│Album│Album│Album│                │
│ │     │     │     │     │                │
│ ├─────┼─────┼─────┼─────┤                │
│ │ 🎵  │ 🎵  │ 🎵  │ 🎵  │                │
│ │Album│Album│Album│Album│                │
│ │     │     │     │     │                │
│ └─────┴─────┴─────┴─────┘                │
│                                           │
│ Artist Name (small overlay at bottom)    │
└───────────────────────────────────────────┘
```

**HTML Structure:**

```html
<div class="poster music-mode covers-only" data-type="music">
    <div class="album-cover-wrapper">
        <img src="/proxy?server=plex&path=..." alt="Album Title" class="album-cover" />
    </div>
    <div class="album-overlay">
        <span class="artist-name">Pink Floyd</span>
    </div>
</div>
```

**CSS:**

```css
.poster.music-mode {
    aspect-ratio: 1 / 1; /* Square for albums */
    position: relative;
    overflow: hidden;
    border-radius: 8px;
}

.poster.music-mode.covers-only .album-cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.poster.music-mode .album-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
    padding: 1rem;
    transform: translateY(100%);
    transition: transform 0.3s ease;
}

.poster.music-mode:hover .album-overlay {
    transform: translateY(0);
}

.poster.music-mode .artist-name {
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
```

---

### Style 2: Album + Artist Info

**Visual Design:**

```
┌───────────────────────────────────────────┐
│ ┌─────────────────────┐                   │
│ │                     │                   │
│ │   🎵 Album Cover    │                   │
│ │                     │                   │
│ ├─────────────────────┤                   │
│ │ Album Title         │                   │
│ │ Artist Name         │                   │
│ │ 1973 • Rock        │                   │
│ └─────────────────────┘                   │
└───────────────────────────────────────────┘
```

**HTML Structure:**

```html
<div class="poster music-mode album-info" data-type="music">
    <div class="album-cover-wrapper">
        <img src="/proxy?server=plex&path=..." alt="Album Title" class="album-cover" />
    </div>
    <div class="info-bar">
        <div class="album-title">Dark Side of the Moon</div>
        <div class="artist-name">Pink Floyd</div>
        <div class="album-meta">
            <span class="year">1973</span>
            <span class="separator">•</span>
            <span class="genre">Progressive Rock</span>
        </div>
    </div>
</div>
```

**CSS:**

```css
.poster.music-mode.album-info {
    display: flex;
    flex-direction: column;
}

.poster.music-mode.album-info .album-cover-wrapper {
    flex: 1;
    min-height: 0;
}

.poster.music-mode.album-info .album-cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.poster.music-mode.album-info .info-bar {
    background: #1a1a1a;
    color: white;
    padding: 1rem;
    min-height: 80px;
}

.poster.music-mode.album-info .album-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.poster.music-mode.album-info .artist-name {
    font-size: 0.875rem;
    color: #b3b3b3;
    margin-bottom: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.poster.music-mode.album-info .album-meta {
    font-size: 0.75rem;
    color: #808080;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.poster.music-mode.album-info .separator {
    opacity: 0.5;
}
```

---

### Style 3: Artist Cards with Albums

**Visual Design:**

```
┌───────────────────────────────────────────┐
│ ┌─────────────┬─────────────────────────┐ │
│ │             │ 🎵  🎵  🎵            │ │
│ │   Artist    │ Album Album Album      │ │
│ │   Photo     │                        │ │
│ │   (blur)    │ 🎵  🎵  🎵            │ │
│ │             │ Album Album Album      │ │
│ ├─────────────┤                        │ │
│ │ Pink Floyd  │ 🎵  🎵  🎵            │ │
│ │ Rock • 1965 │ Album Album Album      │ │
│ │ 15 Albums   │                        │ │
│ └─────────────┴─────────────────────────┘ │
└───────────────────────────────────────────┘
```

**HTML Structure:**

```html
<div class="poster music-mode artist-cards" data-type="music">
    <div class="artist-section">
        <div class="artist-photo" style="background-image: url(...)">
            <div class="artist-overlay"></div>
        </div>
        <div class="artist-info">
            <h3 class="artist-name">Pink Floyd</h3>
            <div class="artist-meta">Rock • 1965 • 15 Albums</div>
        </div>
    </div>
    <div class="albums-grid">
        <div class="mini-album" style="background-image: url(...)"></div>
        <div class="mini-album" style="background-image: url(...)"></div>
        <div class="mini-album" style="background-image: url(...)"></div>
        <!-- 6-9 mini albums total -->
    </div>
</div>
```

**CSS:**

```css
.poster.music-mode.artist-cards {
    display: grid;
    grid-template-columns: 40% 60%;
    background: #1a1a1a;
}

.artist-section {
    position: relative;
    overflow: hidden;
}

.artist-photo {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-size: cover;
    background-position: center;
    filter: blur(8px);
    transform: scale(1.1);
}

.artist-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.8));
}

.artist-info {
    position: relative;
    z-index: 1;
    padding: 1.5rem;
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
}

.artist-info .artist-name {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.artist-info .artist-meta {
    font-size: 0.875rem;
    color: #b3b3b3;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.albums-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    padding: 1rem;
    background: #0a0a0a;
}

.mini-album {
    aspect-ratio: 1 / 1;
    background-size: cover;
    background-position: center;
    border-radius: 4px;
    transition: transform 0.2s;
}

.mini-album:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}
```

---

## Grid Layouts

### Full Grid (Square Layout)

**4x4 Grid for Music:**

```css
.wallart-container.music-mode {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(4, 1fr);
    gap: 1rem;
    padding: 2rem;
    width: 100vw;
    height: 100vh;
    box-sizing: border-box;
}

/* Responsive adjustments */
@media (max-width: 1920px) {
    .wallart-container.music-mode.grid-3x3 {
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
    }
}

@media (min-width: 3840px) {
    .wallart-container.music-mode.grid-6x6 {
        grid-template-columns: repeat(6, 1fr);
        grid-template-rows: repeat(6, 1fr);
    }
}
```

---

### Hero + Grid Layout (Variant A)

**Layout:** 1 Hero (2x2) + 16 Small Albums (4x4 grid)

```css
.wallart-container.music-mode.hero-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    grid-template-rows: repeat(4, 1fr);
    gap: 1rem;
    padding: 2rem;
}

.poster.hero {
    grid-column: 1 / 3;
    grid-row: 1 / 3;
}

/* Album grid positions */
.poster:nth-child(2) {
    grid-column: 3;
    grid-row: 1;
}
.poster:nth-child(3) {
    grid-column: 4;
    grid-row: 1;
}
.poster:nth-child(4) {
    grid-column: 5;
    grid-row: 1;
}
.poster:nth-child(5) {
    grid-column: 6;
    grid-row: 1;
}
.poster:nth-child(6) {
    grid-column: 7;
    grid-row: 1;
}

.poster:nth-child(7) {
    grid-column: 3;
    grid-row: 2;
}
.poster:nth-child(8) {
    grid-column: 4;
    grid-row: 2;
}
/* ... etc for remaining positions */
```

**JavaScript Layout Logic:**

```javascript
function applyHeroGridLayout(albums) {
    const container = document.querySelector('.wallart-container');
    container.classList.add('hero-grid');

    albums.forEach((album, index) => {
        const poster = createPosterElement(album);

        if (index === 0) {
            poster.classList.add('hero');
        }

        container.appendChild(poster);
    });
}
```

---

## Animations

### Vinyl Spin Animation

```css
@keyframes vinyl-spin {
    0% {
        transform: rotate(0deg) scale(0.8);
        opacity: 0;
    }
    50% {
        opacity: 1;
    }
    100% {
        transform: rotate(360deg) scale(1);
        opacity: 1;
    }
}

.poster.music-mode.animating.vinyl-spin {
    animation: vinyl-spin 1.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### Slide & Fade

```css
@keyframes slide-fade {
    0% {
        transform: translateY(50px);
        opacity: 0;
    }
    100% {
        transform: translateY(0);
        opacity: 1;
    }
}

.poster.music-mode.animating.slide-fade {
    animation: slide-fade 0.8s ease-out;
}
```

### Crossfade

```css
@keyframes crossfade {
    0% {
        opacity: 0;
    }
    100% {
        opacity: 1;
    }
}

.poster.music-mode.animating.crossfade {
    animation: crossfade 1s ease-in-out;
}
```

### Flip

```css
@keyframes flip {
    0% {
        transform: rotateY(-90deg);
        opacity: 0;
    }
    100% {
        transform: rotateY(0deg);
        opacity: 1;
    }
}

.poster.music-mode.animating.flip {
    animation: flip 0.6s ease-out;
    transform-style: preserve-3d;
}
```

---

## JavaScript Implementation

**File:** `public/wallart.js`

```javascript
const MusicWallart = {
    init(config) {
        this.config = config;
        this.musicMode = config.musicMode?.enabled || false;
        this.displayStyle = config.musicMode?.displayStyle || 'covers-only';
        this.animation = config.musicMode?.animation || 'vinyl-spin';

        if (this.musicMode) {
            this.setupMusicMode();
        }
    },

    setupMusicMode() {
        const container = document.querySelector('.wallart-container');
        container.classList.add('music-mode');
        container.classList.add(this.displayStyle);

        // Apply layout class
        const layout = this.config.layout || 'grid';
        if (layout === 'hero-grid') {
            container.classList.add('hero-grid');
        }

        this.loadMusicPlaylist();
    },

    async loadMusicPlaylist() {
        try {
            const response = await fetch('/get-media');
            const albums = await response.json();

            // Filter for music type only
            const musicAlbums = albums.filter(item => item.type === 'music');

            if (musicAlbums.length === 0) {
                this.showNoContentMessage();
                return;
            }

            this.playlist = musicAlbums;
            this.currentIndex = 0;

            this.displayAlbums();
            this.startRotation();
        } catch (error) {
            console.error('[Music Wallart] Error loading playlist:', error);
            this.showErrorMessage();
        }
    },

    displayAlbums() {
        const container = document.querySelector('.wallart-container');
        container.innerHTML = '';

        const gridSize = this.getGridSize();
        const albumsToShow = this.playlist.slice(this.currentIndex, this.currentIndex + gridSize);

        albumsToShow.forEach((album, index) => {
            const poster = this.createAlbumPoster(album, index);
            container.appendChild(poster);

            // Trigger animation after a small delay
            setTimeout(() => {
                poster.classList.add('animating', this.animation);
            }, index * 100);
        });
    },

    createAlbumPoster(album, index) {
        const poster = document.createElement('div');
        poster.className = `poster music-mode ${this.displayStyle}`;
        poster.dataset.type = 'music';

        if (index === 0 && this.config.layout === 'hero-grid') {
            poster.classList.add('hero');
        }

        switch (this.displayStyle) {
            case 'covers-only':
                poster.innerHTML = this.renderCoversOnly(album);
                break;
            case 'album-info':
                poster.innerHTML = this.renderAlbumInfo(album);
                break;
            case 'artist-cards':
                poster.innerHTML = this.renderArtistCards(album);
                break;
        }

        return poster;
    },

    renderCoversOnly(album) {
        const showArtist = this.config.musicMode?.showArtist !== false;

        return `
      <div class="album-cover-wrapper">
        <img src="${album.posterUrl}" 
             alt="${album.title}" 
             class="album-cover">
      </div>
      ${
          showArtist
              ? `
        <div class="album-overlay">
          <span class="artist-name">${album.artist}</span>
        </div>
      `
              : ''
      }
    `;
    },

    renderAlbumInfo(album) {
        const config = this.config.musicMode || {};
        const showArtist = config.showArtist !== false;
        const showAlbum = config.showAlbumTitle !== false;
        const showYear = config.showYear !== false;
        const showGenre = config.showGenre === true;

        return `
      <div class="album-cover-wrapper">
        <img src="${album.posterUrl}" 
             alt="${album.title}" 
             class="album-cover">
      </div>
      <div class="info-bar">
        ${showAlbum ? `<div class="album-title">${album.title}</div>` : ''}
        ${showArtist ? `<div class="artist-name">${album.artist}</div>` : ''}
        <div class="album-meta">
          ${showYear && album.year ? `<span class="year">${album.year}</span>` : ''}
          ${showYear && showGenre && album.genres?.length ? `<span class="separator">•</span>` : ''}
          ${showGenre && album.genres?.length ? `<span class="genre">${album.genres[0]}</span>` : ''}
        </div>
      </div>
    `;
    },

    renderArtistCards(album) {
        // For artist cards, we'd need to group albums by artist
        // This is a simplified version showing single album
        return `
      <div class="artist-section">
        <div class="artist-photo" style="background-image: url('${album.artistPhotoUrl || album.backgroundUrl}')">
          <div class="artist-overlay"></div>
        </div>
        <div class="artist-info">
          <h3 class="artist-name">${album.artist}</h3>
          <div class="artist-meta">
            ${album.genres?.[0] || 'Music'} • ${album.year || ''}
          </div>
        </div>
      </div>
      <div class="albums-grid">
        ${this.renderMiniAlbums(album)}
      </div>
    `;
    },

    renderMiniAlbums(album) {
        // Get other albums by same artist
        const artistAlbums = this.playlist.filter(a => a.artist === album.artist).slice(0, 9);

        return artistAlbums
            .map(
                a =>
                    `<div class="mini-album" style="background-image: url('${a.posterUrl}')"></div>`
            )
            .join('');
    },

    getGridSize() {
        const layout = this.config.layout || 'grid';

        if (layout === 'hero-grid') {
            return 17; // 1 hero + 16 grid
        }

        const gridSize = this.config.gridSize || '4x4';
        const [rows, cols] = gridSize.split('x').map(n => parseInt(n));
        return rows * cols;
    },

    startRotation() {
        const interval = (this.config.transitionIntervalSeconds || 30) * 1000;

        this.rotationTimer = setInterval(() => {
            this.rotateAlbums();
        }, interval);
    },

    rotateAlbums() {
        const gridSize = this.getGridSize();
        this.currentIndex = (this.currentIndex + gridSize) % this.playlist.length;
        this.displayAlbums();
    },

    showNoContentMessage() {
        const container = document.querySelector('.wallart-container');
        container.innerHTML = `
      <div class="no-content-message">
        <h2>No Music Albums Found</h2>
        <p>Configure your Plex music libraries in the admin panel</p>
      </div>
    `;
    },

    showErrorMessage() {
        const container = document.querySelector('.wallart-container');
        container.innerHTML = `
      <div class="error-message">
        <h2>Error Loading Music</h2>
        <p>Please check your Plex connection and try again</p>
      </div>
    `;
    },
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    fetch('/get-config')
        .then(res => res.json())
        .then(config => {
            if (config.wallart?.musicMode?.enabled) {
                MusicWallart.init(config.wallart);
            }
        });
});
```

---

## Responsive Design

```css
/* 4K displays */
@media (min-width: 3840px) {
    .wallart-container.music-mode {
        gap: 1.5rem;
        padding: 3rem;
    }

    .poster.music-mode .info-bar {
        padding: 1.5rem;
        min-height: 120px;
    }

    .poster.music-mode .album-title {
        font-size: 1.5rem;
    }
}

/* 1080p displays */
@media (max-width: 1920px) {
    .wallart-container.music-mode {
        gap: 0.75rem;
        padding: 1.5rem;
    }

    .poster.music-mode .info-bar {
        padding: 0.75rem;
        min-height: 70px;
    }
}

/* Portrait orientation */
@media (orientation: portrait) {
    .wallart-container.music-mode {
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(5, 1fr);
    }
}
```

---

## Testing

**File:** `__tests__/public/wallart-music.test.js`

```javascript
describe('Music Wallart Mode', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div class="wallart-container"></div>';
    });

    test('should apply music mode class', () => {
        MusicWallart.init({ musicMode: { enabled: true } });
        const container = document.querySelector('.wallart-container');
        expect(container.classList.contains('music-mode')).toBe(true);
    });

    test('should render covers-only style', () => {
        const album = {
            title: 'Test Album',
            artist: 'Test Artist',
            posterUrl: '/test.jpg',
            type: 'music',
        };

        const poster = MusicWallart.createAlbumPoster(album, 0);
        expect(poster.querySelector('.album-cover')).toBeTruthy();
    });

    test('should calculate correct grid size for hero+grid', () => {
        MusicWallart.config = { layout: 'hero-grid' };
        expect(MusicWallart.getGridSize()).toBe(17);
    });
});
```

---

**Status:** Ready for implementation
