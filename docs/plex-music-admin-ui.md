# Plex Music Admin UI Specification

**Part of:** Plex Music Implementation Plan  
**Phase:** 4 - Admin Interface

---

## Overview

This document specifies the admin interface updates for Plex Music configuration, including UI layout, interactions, and validation.

---

## Admin UI Structure

### Location 1: Media Sources Tab (Plex Configuration)

**File:** `public/admin.html`

**Section:** Plex Media Server configuration card

**Layout:**

```html
<div class="config-section" id="plex-config">
    <h3>Plex Media Server</h3>

    <!-- Existing Plex connection settings -->
    <div class="form-group">
        <label> <input type="checkbox" id="plex-enabled" /> Enable Plex </label>
    </div>

    <div class="form-group">
        <label>Hostname</label>
        <input type="text" id="plex-hostname" placeholder="192.168.1.10" />
    </div>

    <div class="form-group">
        <label>Port</label>
        <input type="number" id="plex-port" value="32400" />
    </div>

    <div class="form-group">
        <label>Token</label>
        <input type="password" id="plex-token" placeholder="Your Plex token" />
    </div>

    <!-- Existing Movie & TV Libraries -->
    <div class="subsection">
        <h4>Movie & TV Libraries</h4>
        <div id="plex-libraries-container">
            <!-- Dynamically populated checkboxes -->
        </div>

        <div class="form-group">
            <label>Genre Filter</label>
            <select id="plex-genre-filter" multiple>
                <!-- Populated from API -->
            </select>
        </div>

        <div class="form-group">
            <label>Minimum Rating</label>
            <input type="number" id="plex-min-rating" min="0" max="10" step="0.1" value="0" />
        </div>
    </div>

    <!-- NEW: Music Libraries Section -->
    <div class="subsection music-config">
        <h4>Music Libraries</h4>

        <div class="form-group">
            <label> <input type="checkbox" id="plex-music-enabled" /> Enable Music </label>
            <small class="help-text">Music appears only in Wallart Music-Only mode</small>
        </div>

        <div id="music-config-options" class="indent" style="display: none;">
            <div class="form-group">
                <label>Select Music Libraries</label>
                <button type="button" id="load-music-libraries" class="btn-secondary">
                    Load Music Libraries
                </button>
                <div id="plex-music-libraries-container" class="checkbox-list">
                    <!-- Dynamically populated -->
                    <div class="loading-spinner" style="display: none;">
                        <span>Loading...</span>
                    </div>
                </div>
            </div>

            <div class="form-group">
                <label>Genre Filter</label>
                <button type="button" id="load-music-genres" class="btn-secondary">
                    Load Genres
                </button>
                <select id="plex-music-genre-filter" multiple size="8">
                    <option disabled>Load libraries first</option>
                </select>
                <small class="help-text">Hold Ctrl/Cmd to select multiple</small>
            </div>

            <div class="form-group">
                <label>Artist Filter (Optional)</label>
                <button type="button" id="load-music-artists" class="btn-secondary">
                    Load Artists
                </button>
                <select id="plex-music-artist-filter" multiple size="8">
                    <option disabled>Load libraries first</option>
                </select>
                <small class="help-text">Leave empty to include all artists</small>
            </div>

            <div class="form-group">
                <label>Minimum Rating</label>
                <input
                    type="number"
                    id="plex-music-min-rating"
                    min="0"
                    max="10"
                    step="0.1"
                    value="0"
                />
                <small class="help-text">0 = include all albums</small>
            </div>
        </div>
    </div>
</div>
```

---

### Location 2: Display Settings Tab (Wallart Configuration)

**File:** `public/admin.html`

**Section:** Wallart settings

**Layout:**

```html
<div class="config-section" id="wallart-config">
    <h3>Wallart Display Settings</h3>

    <!-- Existing general settings -->
    <div class="form-group">
        <label>Grid Size</label>
        <select id="wallart-grid-size">
            <option value="3x3">3×3 (9 items)</option>
            <option value="4x4" selected>4×4 (16 items)</option>
            <option value="5x5">5×5 (25 items)</option>
            <option value="6x6">6×6 (36 items)</option>
        </select>
    </div>

    <div class="form-group">
        <label>Layout</label>
        <div class="radio-group">
            <label>
                <input type="radio" name="wallart-layout" value="grid" checked />
                Full Grid
            </label>
            <label>
                <input type="radio" name="wallart-layout" value="hero-grid" />
                Hero + Grid
            </label>
        </div>
    </div>

    <!-- Content Mode Selection -->
    <div class="form-group">
        <label>Content Mode</label>
        <div class="radio-group vertical">
            <label>
                <input type="radio" name="content-mode" value="mixed" checked />
                All Content (Mixed)
            </label>
            <label>
                <input type="radio" name="content-mode" value="games" />
                Games Only <span class="badge">Square Layout</span>
            </label>
            <label>
                <input type="radio" name="content-mode" value="music" />
                Music Only <span class="badge">Square Layout</span>
            </label>
        </div>
        <small class="help-text"> Music and Games cannot be mixed with other content types </small>
    </div>

    <!-- NEW: Music Display Options -->
    <div id="music-display-options" class="subsection" style="display: none;">
        <h4>Music Display Options</h4>

        <div class="form-group">
            <label>Display Style</label>
            <div class="radio-group vertical">
                <label class="with-preview">
                    <input type="radio" name="music-display-style" value="covers-only" checked />
                    <div class="option-content">
                        <span class="option-title">Album Covers Only</span>
                        <span class="option-desc"
                            >Clean grid of album artwork with minimal text</span
                        >
                    </div>
                </label>

                <label class="with-preview">
                    <input type="radio" name="music-display-style" value="album-info" />
                    <div class="option-content">
                        <span class="option-title">Album + Artist Info</span>
                        <span class="option-desc"
                            >Album cover with info bar showing artist, album, year</span
                        >
                    </div>
                </label>

                <label class="with-preview">
                    <input type="radio" name="music-display-style" value="artist-cards" />
                    <div class="option-content">
                        <span class="option-title">Artist Cards with Albums</span>
                        <span class="option-desc"
                            >Magazine-style cards with artist photo and album grid</span
                        >
                    </div>
                </label>
            </div>
        </div>

        <div class="form-group">
            <label>Show on Albums</label>
            <div class="checkbox-group">
                <label>
                    <input type="checkbox" id="music-show-artist" checked /> Artist Name
                </label>
                <label> <input type="checkbox" id="music-show-album" checked /> Album Title </label>
                <label> <input type="checkbox" id="music-show-year" checked /> Release Year </label>
                <label> <input type="checkbox" id="music-show-genre" /> Genre Tags </label>
            </div>
        </div>

        <div class="form-group">
            <label>Animation Style</label>
            <select id="music-animation">
                <option value="vinyl-spin" selected>Vinyl Spin (Default)</option>
                <option value="slide-fade">Slide & Fade</option>
                <option value="crossfade">Crossfade</option>
                <option value="flip">Flip</option>
            </select>
            <small class="help-text">Vinyl Spin creates a nostalgic rotating effect</small>
        </div>

        <div class="form-group">
            <label>Album Sorting</label>
            <select id="music-sorting-mode">
                <option value="weighted-random" selected>Smart Mix (Recommended)</option>
                <option value="recent">Recently Added</option>
                <option value="popular">Most Played</option>
                <option value="alphabetical">Alphabetical (A-Z)</option>
                <option value="random">Pure Random</option>
            </select>
        </div>

        <div id="music-sorting-weights" class="indent" style="display: block;">
            <label class="section-label">Smart Mix Weights</label>
            <div class="slider-group">
                <div class="slider-row">
                    <label>Recent Albums</label>
                    <input type="range" id="music-weight-recent" min="0" max="100" value="20" />
                    <span class="value">20%</span>
                </div>
                <div class="slider-row">
                    <label>Popular Albums</label>
                    <input type="range" id="music-weight-popular" min="0" max="100" value="30" />
                    <span class="value">30%</span>
                </div>
                <div class="slider-row">
                    <label>Random Albums</label>
                    <input type="range" id="music-weight-random" min="0" max="100" value="50" />
                    <span class="value">50%</span>
                </div>
            </div>
            <small class="help-text">
                Adjust weights to balance between new, popular, and rediscovered albums
            </small>
        </div>
    </div>
</div>
```

---

## CSS Styles

**File:** `public/admin.css`

```css
/* Music Configuration Section */
.music-config {
    border-top: 2px solid #e0e0e0;
    margin-top: 2rem;
    padding-top: 1.5rem;
}

.music-config h4 {
    color: #1db954; /* Spotify green accent */
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.music-config h4::before {
    content: '🎵';
    font-size: 1.2em;
}

/* Checkbox list for libraries */
.checkbox-list {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #ddd;
    padding: 0.5rem;
    border-radius: 4px;
    background: #fafafa;
}

.checkbox-list label {
    display: block;
    padding: 0.25rem 0;
}

.checkbox-list .loading-spinner {
    text-align: center;
    padding: 1rem;
    color: #666;
}

/* Display style options */
.with-preview {
    display: flex;
    align-items: flex-start;
    padding: 0.75rem;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
}

.with-preview:hover {
    border-color: #1db954;
    background: #f9f9f9;
}

.with-preview input[type='radio'] {
    margin-top: 0.25rem;
}

.with-preview input[type='radio']:checked + .option-content {
    color: #1db954;
}

.option-content {
    margin-left: 0.5rem;
    flex: 1;
}

.option-title {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
}

.option-desc {
    display: block;
    font-size: 0.875rem;
    color: #666;
}

/* Slider group */
.slider-group {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 8px;
}

.slider-row {
    display: grid;
    grid-template-columns: 150px 1fr 50px;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
}

.slider-row:last-child {
    margin-bottom: 0;
}

.slider-row label {
    font-size: 0.875rem;
    font-weight: 500;
}

.slider-row input[type='range'] {
    width: 100%;
}

.slider-row .value {
    text-align: right;
    font-weight: 600;
    color: #1db954;
}

/* Badge */
.badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    background: #1db954;
    color: white;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-left: 0.5rem;
}

/* Help text */
.help-text {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: #666;
    font-style: italic;
}

/* Indent for nested options */
.indent {
    margin-left: 1.5rem;
    padding-left: 1rem;
    border-left: 3px solid #e0e0e0;
}
```

---

## JavaScript Logic

**File:** `public/admin.js`

```javascript
// Music configuration management
const MusicConfig = {
    init() {
        this.bindEvents();
        this.loadInitialState();
    },

    bindEvents() {
        // Toggle music config visibility
        $('#plex-music-enabled').on('change', e => {
            const enabled = e.target.checked;
            $('#music-config-options').toggle(enabled);

            if (enabled) {
                this.loadMusicLibraries();
            }
        });

        // Load music libraries button
        $('#load-music-libraries').on('click', () => {
            this.loadMusicLibraries();
        });

        // Load genres button
        $('#load-music-genres').on('click', () => {
            this.loadMusicGenres();
        });

        // Load artists button
        $('#load-music-artists').on('click', () => {
            this.loadMusicArtists();
        });

        // Content mode radio buttons
        $('input[name="content-mode"]').on('change', e => {
            const mode = e.target.value;
            $('#music-display-options').toggle(mode === 'music');

            if (mode === 'music') {
                this.showMusicWarning();
            }
        });

        // Sorting mode changes
        $('#music-sorting-mode').on('change', e => {
            const mode = e.target.value;
            $('#music-sorting-weights').toggle(mode === 'weighted-random');
        });

        // Weight sliders
        $('.slider-row input[type="range"]').on('input', e => {
            const value = e.target.value;
            $(e.target).siblings('.value').text(`${value}%`);
            this.updateWeightTotal();
        });
    },

    async loadMusicLibraries() {
        const $container = $('#plex-music-libraries-container');
        const $spinner = $container.find('.loading-spinner');

        $spinner.show();

        try {
            const response = await fetch('/api/admin/plex/music-libraries');
            const data = await response.json();

            if (data.success) {
                this.renderMusicLibraries(data.libraries);
            } else {
                showNotification('Error loading music libraries: ' + data.error, 'error');
            }
        } catch (error) {
            showNotification('Failed to load music libraries', 'error');
            console.error(error);
        } finally {
            $spinner.hide();
        }
    },

    renderMusicLibraries(libraries) {
        const $container = $('#plex-music-libraries-container');
        $container.empty();

        if (libraries.length === 0) {
            $container.append('<p class="no-results">No music libraries found</p>');
            return;
        }

        libraries.forEach(lib => {
            const checkbox = $(`
        <label>
          <input type="checkbox" 
                 name="music-library" 
                 value="${lib.name}" 
                 data-key="${lib.key}">
          ${lib.name} 
          <span class="library-stats">
            (${lib.albumCount} albums, ${lib.artistCount} artists)
          </span>
        </label>
      `);

            $container.append(checkbox);
        });
    },

    async loadMusicGenres() {
        const selectedLibraries = this.getSelectedLibraries();

        if (selectedLibraries.length === 0) {
            showNotification('Please select at least one music library first', 'warning');
            return;
        }

        try {
            const params = new URLSearchParams({
                libraries: selectedLibraries.join(','),
            });

            const response = await fetch(`/api/admin/plex/music-genres?${params}`);
            const data = await response.json();

            if (data.success) {
                this.renderGenres(data.genres);
            }
        } catch (error) {
            showNotification('Failed to load genres', 'error');
            console.error(error);
        }
    },

    renderGenres(genres) {
        const $select = $('#plex-music-genre-filter');
        $select.empty();

        if (genres.length === 0) {
            $select.append('<option disabled>No genres found</option>');
            return;
        }

        genres.forEach(genre => {
            $select.append(`<option value="${genre}">${genre}</option>`);
        });
    },

    async loadMusicArtists() {
        const selectedLibraries = this.getSelectedLibraries();

        if (selectedLibraries.length === 0) {
            showNotification('Please select at least one music library first', 'warning');
            return;
        }

        try {
            const params = new URLSearchParams({
                libraries: selectedLibraries.join(','),
                limit: 200,
            });

            const response = await fetch(`/api/admin/plex/music-artists?${params}`);
            const data = await response.json();

            if (data.success) {
                this.renderArtists(data.artists, data.total);
            }
        } catch (error) {
            showNotification('Failed to load artists', 'error');
            console.error(error);
        }
    },

    renderArtists(artists, total) {
        const $select = $('#plex-music-artist-filter');
        $select.empty();

        if (artists.length === 0) {
            $select.append('<option disabled>No artists found</option>');
            return;
        }

        if (total > artists.length) {
            $select.append(
                `<option disabled>Showing ${artists.length} of ${total} artists</option>`
            );
        }

        artists.forEach(artist => {
            $select.append(`
        <option value="${artist.name}">
          ${artist.name} (${artist.albumCount} albums)
        </option>
      `);
        });
    },

    getSelectedLibraries() {
        return $('input[name="music-library"]:checked')
            .map((i, el) => $(el).val())
            .get();
    },

    updateWeightTotal() {
        const recent = parseInt($('#music-weight-recent').val());
        const popular = parseInt($('#music-weight-popular').val());
        const random = parseInt($('#music-weight-random').val());
        const total = recent + popular + random;

        // Optionally show total or normalize
        console.log(`Weight total: ${total}%`);
    },

    showMusicWarning() {
        showNotification(
            'Music Only mode: Only albums will be displayed. Movies, TV shows, and games will be hidden.',
            'info',
            5000
        );
    },

    loadInitialState() {
        // Load from config
        const config = window.currentConfig || {};

        if (config.plex?.musicEnabled) {
            $('#plex-music-enabled').prop('checked', true);
            $('#music-config-options').show();
        }

        if (config.wallart?.musicMode?.enabled) {
            $('input[name="content-mode"][value="music"]').prop('checked', true);
            $('#music-display-options').show();
        }
    },

    getConfigData() {
        return {
            plex: {
                musicEnabled: $('#plex-music-enabled').is(':checked'),
                musicLibraries: this.getSelectedLibraries(),
                musicFilters: {
                    genres: $('#plex-music-genre-filter').val() || [],
                    artists: $('#plex-music-artist-filter').val() || [],
                    minRating: parseFloat($('#plex-music-min-rating').val()) || 0,
                },
            },
            wallart: {
                musicMode: {
                    enabled: $('input[name="content-mode"]:checked').val() === 'music',
                    displayStyle: $('input[name="music-display-style"]:checked').val(),
                    showArtist: $('#music-show-artist').is(':checked'),
                    showAlbumTitle: $('#music-show-album').is(':checked'),
                    showYear: $('#music-show-year').is(':checked'),
                    showGenre: $('#music-show-genre').is(':checked'),
                    animation: $('#music-animation').val(),
                    sorting: {
                        mode: $('#music-sorting-mode').val(),
                        recentWeight: parseInt($('#music-weight-recent').val()),
                        popularWeight: parseInt($('#music-weight-popular').val()),
                        randomWeight: parseInt($('#music-weight-random').val()),
                    },
                },
            },
        };
    },
};

// Initialize on page load
$(document).ready(() => {
    MusicConfig.init();
});
```

---

## Validation Rules

1. **Library Selection:** At least one library must be selected if music is enabled
2. **Weight Total:** No validation needed (flexible weighting)
3. **Mode Exclusivity:** Prevent both Games Only and Music Mode being enabled
4. **Plex Connection:** Music features disabled if Plex is not configured

---

**Status:** Ready for implementation
