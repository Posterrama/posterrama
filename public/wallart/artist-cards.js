/**
 * Artist Cards Module - Unique card-based layout for music artists
 * Shows artist photos with metadata and rotating album covers
 */

console.log('[Artist Cards] Script loaded - setting up message listener');

(function () {
    'use strict';

    window.ArtistCards = {
        /**
         * Initialize artist cards display
         * @param {object} params - Configuration parameters
         * @returns {object} State object with currentPosters and usedPosters
         */
        initialize(params) {
            console.log('[Artist Cards] Initialize called with:', {
                hasContainer: !!params.container,
                mediaCount: params.mediaQueue?.length || 0,
                hasConfig: !!params.appConfig,
            });

            const { container, mediaQueue = [], appConfig = {} } = params;

            if (!container || !mediaQueue.length) {
                console.log('[Artist Cards] Early return - no container or media');
                return { currentPosters: [], usedPosters: new Set() };
            }

            // Inject CSS animations
            if (!document.getElementById('artist-cards-animations')) {
                const style = document.createElement('style');
                style.id = 'artist-cards-animations';
                style.textContent = `
                    @keyframes cardFadeIn {
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes albumRotate {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Extract accent color from config (default Deep Blue)
            const accentColor =
                appConfig?.wallartMode?.musicMode?.artistCards?.accentColor || '#143c8c';
            console.log('[Artist Cards] Config:', {
                accentColor: accentColor,
            });

            // Group albums by artist
            const artistMap = this.groupByArtist(mediaQueue);
            let artists = Array.from(artistMap.values());
            console.log('[Artist Cards] Grouped into', artists.length, 'artists');

            if (artists.length === 0) {
                console.warn('[Artist Cards] No artists found after grouping');
                return { currentPosters: [], usedPosters: new Set() };
            }

            // Shuffle artists randomly so we see different ones each session
            artists = artists.sort(() => Math.random() - 0.5);
            console.log('[Artist Cards] Artists shuffled randomly');

            // Clear container and set up single card layout
            container.innerHTML = '';
            container.style.cssText = `
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                background: #000 !important;
                width: 100vw !important;
                height: 100vh !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
                z-index: 1000 !important;
                padding: 2.5vh !important;
            `;

            const currentPosters = [];
            const usedPosters = new Set();

            // Get artist rotation interval from config (default 60 seconds)
            const rotationSeconds = appConfig?.wallartMode?.musicMode?.artistRotationSeconds ?? 60;
            console.log('[Artist Cards] Artist rotation interval:', rotationSeconds, 'seconds');

            // Show 1 artist at a time
            let currentArtistIndex = 0;
            let currentCard = null;

            const showArtist = () => {
                console.log('[Artist Cards] Showing artist', currentArtistIndex);
                container.innerHTML = '';

                const artistData = artists[currentArtistIndex];
                console.log('[Artist Cards] Creating card for artist:', artistData.name);
                currentCard = this.createArtistCard(artistData, accentColor);
                container.appendChild(currentCard);

                // Start album rotation for this artist's card
                this.startAlbumRotation(currentCard, artistData);
            };

            // Initial display
            console.log('[Artist Cards] Starting initial display');
            showArtist();

            // Rotate to next artist using config interval
            setInterval(() => {
                currentArtistIndex = (currentArtistIndex + 1) % artists.length;
                showArtist();
            }, rotationSeconds * 1000);

            // Track all albums from all artists
            artists.forEach(artistData => {
                artistData.albums.forEach(album => {
                    currentPosters.push(album);
                    usedPosters.add(album.key || album.id);
                });
            });

            return { currentPosters, usedPosters };
        },

        /**
         * Group albums by artist
         * @param {array} albums - Array of album objects
         * @returns {Map} Map of artist name to artist data
         */
        groupByArtist(mediaQueue) {
            const artistMap = new Map();

            console.log('[Artist Cards] Grouping', mediaQueue.length, 'albums');

            // Filter out null/undefined items first
            const validItems = mediaQueue.filter(item => item != null);
            console.log('[Artist Cards] Valid items after filtering:', validItems.length);

            validItems.forEach(item => {
                const artistName = item.artist || item.parentTitle || 'Unknown Artist';

                if (!artistMap.has(artistName)) {
                    artistMap.set(artistName, {
                        name: artistName,
                        albums: [],
                        photo: item.artistPhoto || null, // Only use artistPhoto, not backdrop
                        genres: new Set(),
                        styles: new Set(),
                    });
                } else {
                    // Update photo if we didn't have one yet
                    const existingData = artistMap.get(artistName);
                    if (!existingData.photo && item.artistPhoto) {
                        existingData.photo = item.artistPhoto;
                    }
                }

                const artistData = artistMap.get(artistName);
                artistData.albums.push(item);

                // Collect genres from item
                if (item.genre) {
                    const genres = item.genre.split(',').map(g => g.trim());
                    genres.forEach(g => artistData.genres.add(g));
                }

                // Collect genres from artist metadata
                if (item.artistGenres && Array.isArray(item.artistGenres)) {
                    item.artistGenres.forEach(g => artistData.genres.add(g));
                }

                // Collect styles from artist metadata
                if (item.artistStyles && Array.isArray(item.artistStyles)) {
                    item.artistStyles.forEach(s => artistData.styles.add(s));
                }
            });

            // Log album counts per artist
            artistMap.forEach((data, name) => {
                if (data.albums.length > 5) {
                    console.log(`[Artist Cards] ${name}: ${data.albums.length} albums`);
                }
            });

            return artistMap;
        },

        /**
         * Create a single artist card
         * @param {object} artistData - Artist data with albums
         * @param {string} accentColor - Hex color for overlay (default #143c8c)
         * @returns {HTMLElement} Card element
         */
        createArtistCard(artistData, accentColor = '#143c8c') {
            // Convert hex to RGB for gradient
            const rgb = this.hexToRgb(accentColor);
            const darkRgb = {
                r: Math.floor(rgb.r * 0.67),
                g: Math.floor(rgb.g * 0.67),
                b: Math.floor(rgb.b * 0.67),
            };

            // Detect portrait orientation (9:16 or similar)
            const isPortrait = window.innerHeight > window.innerWidth;

            const card = document.createElement('div');
            card.className = 'artist-card';
            card.style.cssText = `
                width: 100%;
                height: 100%;
                background: transparent;
                border-radius: 24px;
                overflow: hidden;
                position: relative;
                box-sizing: border-box;
                display: flex;
                flex-direction: ${isPortrait ? 'column' : 'row'};
                opacity: 0;
                transform: scale(0.92);
                animation: cardFadeIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            `;

            // Background layer: Two versions of the same photo
            if (artistData.photo) {
                if (isPortrait) {
                    // Portrait: Top section with blue monochrome effect
                    const blueContainer = document.createElement('div');
                    blueContainer.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 35%;
                        overflow: hidden;
                        z-index: 0;
                    `;

                    // Grayscale photo
                    const bluePhoto = document.createElement('img');
                    bluePhoto.src = artistData.photo;
                    bluePhoto.style.cssText = `
                        width: 100%;
                        height: 285%;
                        object-fit: cover;
                        object-position: center top;
                        filter: grayscale(100%) contrast(1.1);
                    `;
                    blueContainer.appendChild(bluePhoto);

                    // Accent color overlay
                    const blueOverlay = document.createElement('div');
                    blueOverlay.className = 'artist-card-overlay';
                    blueOverlay.style.cssText = `
                        position: absolute;
                        inset: 0;
                        background: linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75), rgba(${darkRgb.r}, ${darkRgb.g}, ${darkRgb.b}, 0.80));
                        mix-blend-mode: multiply;
                        pointer-events: none;
                    `;
                    blueContainer.appendChild(blueOverlay);

                    card.appendChild(blueContainer);

                    // Bottom section: Original colors (65%)
                    const originalPhoto = document.createElement('img');
                    originalPhoto.src = artistData.photo;
                    originalPhoto.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        object-position: center;
                        clip-path: inset(35% 0 0 0);
                        z-index: 0;
                    `;
                    card.appendChild(originalPhoto);
                } else {
                    // Landscape: Left side blue monochrome (40%), right side original (60%)
                    const blueContainer = document.createElement('div');
                    blueContainer.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 40%;
                        height: 100%;
                        overflow: hidden;
                        z-index: 0;
                    `;

                    // Grayscale photo
                    const bluePhoto = document.createElement('img');
                    bluePhoto.src = artistData.photo;
                    bluePhoto.style.cssText = `
                        width: 250%;
                        height: 100%;
                        object-fit: cover;
                        object-position: left center;
                        filter: grayscale(100%) contrast(1.1);
                    `;
                    blueContainer.appendChild(bluePhoto);

                    // Accent color overlay
                    const blueOverlay = document.createElement('div');
                    blueOverlay.className = 'artist-card-overlay';
                    blueOverlay.style.cssText = `
                        position: absolute;
                        inset: 0;
                        background: linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75), rgba(${darkRgb.r}, ${darkRgb.g}, ${darkRgb.b}, 0.80));
                        mix-blend-mode: multiply;
                        pointer-events: none;
                    `;
                    blueContainer.appendChild(blueOverlay);

                    card.appendChild(blueContainer);

                    // Right side: Original colors (60%)
                    const originalPhoto = document.createElement('img');
                    originalPhoto.src = artistData.photo;
                    originalPhoto.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        object-position: center;
                        clip-path: inset(0 0 0 40%);
                        z-index: 0;
                    `;
                    card.appendChild(originalPhoto);
                }
            }

            // INFO SECTION - Adapts to portrait/landscape
            const infoSection = document.createElement('div');
            infoSection.style.cssText = isPortrait
                ? `
                width: 100%;
                height: 35%;
                padding: 3vh 5vw;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                position: relative;
                z-index: 1;
            `
                : `
                width: 40%;
                height: 100%;
                padding: 3vh 3vw;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                position: relative;
                z-index: 1;
            `;

            // Artist Name - responsive font size
            const artistName = document.createElement('div');
            artistName.textContent = artistData.name;
            artistName.style.cssText = isPortrait
                ? `
                font-size: 7vw;
                font-weight: 900;
                color: #fff;
                line-height: 1;
                text-shadow: 0 4px 20px rgba(0,0,0,0.7);
                margin-bottom: 1.5vh;
                letter-spacing: -0.03em;
                position: relative;
                z-index: 2;
            `
                : `
                font-size: 4vw;
                font-weight: 900;
                color: #fff;
                line-height: 1;
                text-shadow: 0 4px 20px rgba(0,0,0,0.7);
                margin-bottom: 1.5vh;
                letter-spacing: -0.03em;
                position: relative;
                z-index: 2;
            `;
            infoSection.appendChild(artistName);

            // Metadata
            const metadata = document.createElement('div');
            metadata.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 0.8vh;
                margin-bottom: auto;
                position: relative;
                z-index: 2;
            `;

            // Genres - responsive font size
            if (artistData.genres.size > 0) {
                const genresArray = Array.from(artistData.genres).slice(0, 3);
                const genresRow = document.createElement('div');
                genresRow.style.cssText = isPortrait
                    ? `
                    font-size: 3.5vw;
                    color: rgba(255,255,255,0.7);
                    font-weight: 500;
                `
                    : `
                    font-size: 1.3vw;
                    color: rgba(255,255,255,0.7);
                    font-weight: 500;
                `;
                genresRow.textContent = genresArray.join(', ');
                metadata.appendChild(genresRow);
            }

            // Album count - responsive font size
            const albumCountRow = document.createElement('div');
            albumCountRow.style.cssText = isPortrait
                ? `
                font-size: 3.5vw;
                color: rgba(255,255,255,0.7);
                font-weight: 500;
            `
                : `
                font-size: 1.3vw;
                color: rgba(255,255,255,0.7);
                font-weight: 500;
            `;
            const albumWord = artistData.albums.length === 1 ? 'Album' : 'Albums';
            albumCountRow.textContent = `${artistData.albums.length} ${albumWord}`;
            metadata.appendChild(albumCountRow);

            // Album list - responsive font size (skip on portrait to save space)
            if (!isPortrait) {
                const albumList = document.createElement('div');
                albumList.style.cssText = `
                    font-size: 1.1vw;
                    color: rgba(255,255,255,0.6);
                    line-height: 1.6;
                    font-style: italic;
                    margin-top: 1vh;
                    padding-right: 2vw;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                `;
                const albumTitles = artistData.albums
                    .slice(0, 5)
                    .map(a => a.title)
                    .join(', ');
                albumList.textContent = `"${artistData.albums.length > 5 ? albumTitles + '...' : albumTitles}"`;
                metadata.appendChild(albumList);
            }

            infoSection.appendChild(metadata);
            card.appendChild(infoSection);

            // PHOTO SECTION - Original photo visible
            const photoSection = document.createElement('div');
            photoSection.style.cssText = isPortrait
                ? `
                width: 100%;
                height: 65%;
                position: relative;
                z-index: 1;
            `
                : `
                width: 60%;
                height: 100%;
                position: relative;
                z-index: 1;
            `;
            card.appendChild(photoSection);

            // BOTTOM - Album Covers Grid (full width at bottom, over both panels)
            const albumGrid = document.createElement('div');
            albumGrid.className = 'artist-album-grid';

            // Adjust album grid for portrait: fewer albums, larger covers
            const maxAlbums = isPortrait ? 5 : 8;
            const gridGap = isPortrait ? '2vw' : '1.5vw';

            albumGrid.style.cssText = isPortrait
                ? `
                position: absolute;
                bottom: 2vh;
                left: 4vw;
                right: 4vw;
                display: flex;
                gap: ${gridGap};
                z-index: 3;
            `
                : `
                position: absolute;
                bottom: 2vh;
                left: 2vw;
                right: 2vw;
                display: flex;
                gap: ${gridGap};
                z-index: 3;
            `;

            // Show up to maxAlbums covers (pick UNIQUE albums, randomized)
            const albumsToShow = [];
            const usedIds = new Set(); // Track unique IDs to prevent duplicates
            const targetCount = Math.min(maxAlbums, artistData.albums.length);

            if (artistData.albums.length === 0) {
                // No albums - will show empty placeholders
            } else {
                // Pick random UNIQUE albums up to target count
                const shuffled = [...artistData.albums].sort(() => Math.random() - 0.5);

                // Pick albums ensuring each is unique by ID
                for (const album of shuffled) {
                    if (albumsToShow.length >= targetCount) break;

                    const albumId = album.id || album.key || album.posterUrl;
                    if (!usedIds.has(albumId)) {
                        albumsToShow.push(album);
                        usedIds.add(albumId);
                    }
                }
            }

            const visibleAlbums = albumsToShow;
            visibleAlbums.forEach((album, idx) => {
                const albumCover = document.createElement('img');
                albumCover.src = album.posterUrl || '';
                albumCover.alt = album.title || '';

                // Calculate width based on number of albums and gaps
                const gapsCount = maxAlbums - 1;
                const gapValue = isPortrait ? 2 : 1.5;
                const coverWidth = `calc((100% - (${gapsCount} * ${gapValue}vw)) / ${maxAlbums})`;

                albumCover.style.cssText = `
                    width: ${coverWidth};
                    aspect-ratio: 1;
                    flex-shrink: 0;
                    object-fit: cover;
                    border-radius: ${isPortrait ? '1vw' : '0.6vw'};
                    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                    opacity: 0;
                    animation: albumFadeIn 0.6s ease forwards;
                    animation-delay: ${0.3 + idx * 0.1}s;
                `;
                albumCover.onerror = () => {
                    albumCover.style.background =
                        'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)';
                };
                albumGrid.appendChild(albumCover);
            });

            card.appendChild(albumGrid);

            return card;
        },

        /**
         * Start automatic album rotation for an artist card
         * @param {HTMLElement} card - The artist card element
         * @param {object} artistData - Artist data with albums array
         */
        startAlbumRotation(card, artistData) {
            // Don't rotate if only 1 album (nothing to rotate to)
            if (!artistData.albums || artistData.albums.length <= 1) {
                console.log('[Artist Cards] Not enough albums to rotate for', artistData.name);
                return;
            }

            const albumGrid = card.querySelector('.artist-album-grid');
            if (!albumGrid) {
                console.warn('[Artist Cards] Could not find album grid');
                return;
            }

            const allAlbums = [...artistData.albums];

            // Track currently visible album IDs to ensure uniqueness
            const getCurrentlyVisibleIds = () => {
                const albumCovers = albumGrid.querySelectorAll('img');
                const ids = new Set();
                albumCovers.forEach(img => {
                    const src = img.src;
                    // Extract album identifier from src
                    if (src) ids.add(src);
                });
                return ids;
            };

            console.log(
                '[Artist Cards] Starting album rotation for',
                artistData.name,
                '-',
                allAlbums.length,
                'total albums'
            );

            // Get album rotation interval from config (default 15 seconds)
            const albumRotationSeconds =
                window.appConfig?.wallartMode?.musicMode?.albumRotationSeconds ?? 15;
            console.log('[Artist Cards] Album rotation interval:', albumRotationSeconds, 'seconds');

            // Rotate albums at configured interval
            const rotationInterval = setInterval(() => {
                // Stop if card is removed from DOM
                if (!card.isConnected) {
                    clearInterval(rotationInterval);
                    return;
                }

                const albumCovers = albumGrid.querySelectorAll('img');
                if (albumCovers.length === 0) return;

                // Get currently visible album URLs to avoid duplicates
                const visibleUrls = getCurrentlyVisibleIds();

                // Build pool of albums NOT currently visible
                const availableAlbums = allAlbums.filter(
                    album => !visibleUrls.has(album.posterUrl)
                );

                // If not enough different albums available, skip rotation
                // (e.g., only 2 albums and both are showing)
                if (availableAlbums.length === 0) {
                    console.log('[Artist Cards] All albums currently visible, skipping rotation');
                    return;
                }

                // For each visible position, pick a NEW album from available pool
                const nextAlbums = [];
                const usedInRotation = new Set();

                for (let i = 0; i < albumCovers.length; i++) {
                    // Filter out albums we've already picked for this rotation
                    const stillAvailable = availableAlbums.filter(
                        album => !usedInRotation.has(album.posterUrl)
                    );

                    if (stillAvailable.length > 0) {
                        // Pick random album from available pool
                        const randomIndex = Math.floor(Math.random() * stillAvailable.length);
                        const chosen = stillAvailable[randomIndex];
                        nextAlbums.push(chosen);
                        usedInRotation.add(chosen.posterUrl);
                    } else {
                        // Not enough unique albums, reuse from available pool
                        const randomIndex = Math.floor(Math.random() * availableAlbums.length);
                        nextAlbums.push(availableAlbums[randomIndex]);
                    }
                }

                // Animate each album cover with staggered timing
                albumCovers.forEach((img, idx) => {
                    // Skip if no next album for this position
                    if (idx >= nextAlbums.length) return;

                    const nextAlbum = nextAlbums[idx];

                    setTimeout(() => {
                        // Smooth fade out with scale
                        img.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                        img.style.opacity = '0';
                        img.style.transform = 'scale(0.9)';

                        // Change source and fade in
                        setTimeout(() => {
                            img.src = nextAlbum.posterUrl || '';
                            img.alt = nextAlbum.title || '';

                            // Reset transform and fade in
                            setTimeout(() => {
                                img.style.opacity = '1';
                                img.style.transform = 'scale(1)';
                            }, 50);
                        }, 400);
                    }, idx * 150); // Stagger by 150ms per cover
                });
            }, albumRotationSeconds * 1000); // Use configured interval
        },

        /**
         * Convert hex color to RGB object
         * @param {string} hex - Hex color string (e.g. '#143c8c')
         * @returns {object} RGB object with r, g, b properties
         */
        hexToRgb(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result
                ? {
                      r: parseInt(result[1], 16),
                      g: parseInt(result[2], 16),
                      b: parseInt(result[3], 16),
                  }
                : { r: 20, g: 60, b: 140 }; // Default Deep Blue
        },
    };

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes cardFadeIn {
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        
        @keyframes albumFadeIn {
            to {
                opacity: 1;
            }
        }
        
        .artist-card {
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease;
        }
        
        .artist-card:hover {
            transform: translateY(-8px) scale(1.02);
            box-shadow: 0 24px 64px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.15);
        }
        
        .artist-card img {
            transition: opacity 0.3s ease;
        }
    `;
    document.head.appendChild(style);

    // Listen for live accent color updates from admin interface
    console.log('[Artist Cards] Registering message listener for accent color updates');
    window.addEventListener('message', event => {
        console.log('[Artist Cards] Received message:', event.data);
        if (event.data && event.data.type === 'ARTISTCARDS_ACCENT_COLOR_UPDATE') {
            const newColor = event.data.color;
            console.log('[Artist Cards] Received live color update:', newColor);

            // Update all overlay elements with new gradient
            const overlays = document.querySelectorAll('.artist-card-overlay');
            overlays.forEach(overlay => {
                const rgb = window.ArtistCards.hexToRgb(newColor);
                const darkRgb = {
                    r: Math.floor(rgb.r * 0.67),
                    g: Math.floor(rgb.g * 0.67),
                    b: Math.floor(rgb.b * 0.67),
                };
                overlay.style.background = `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75), rgba(${darkRgb.r}, ${darkRgb.g}, ${darkRgb.b}, 0.80))`;
            });
        }
    });
})();
