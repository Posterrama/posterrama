/**
 * Artist Cards Module - Unique card-based layout for music artists
 * Shows artist photos with metadata and rotating album covers
 */

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
                currentCard = this.createArtistCard(artistData);
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
         * @param {number} index - Card index for animation delay
         * @returns {HTMLElement} Card element
         */
        createArtistCard(artistData) {
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
                opacity: 0;
                transform: scale(0.92);
                animation: cardFadeIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            `;

            // LEFT SIDE - Info + Albums (40% width)
            const leftSide = document.createElement('div');
            leftSide.style.cssText = `
                width: 40%;
                height: 100%;
                background: linear-gradient(135deg, #16213e 0%, #0f1822 100%);
                padding: 3vh 3vw;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                position: relative;
            `;

            // TOP - Artist Name
            const artistName = document.createElement('div');
            artistName.textContent = artistData.name;
            artistName.style.cssText = `
                font-size: 4vw;
                font-weight: 900;
                color: #fff;
                line-height: 1;
                text-shadow: 0 4px 20px rgba(0,0,0,0.7);
                margin-bottom: 1.5vh;
                letter-spacing: -0.03em;
                position: relative;
                z-index: 1;
            `;
            leftSide.appendChild(artistName);

            // MIDDLE - Metadata
            const metadata = document.createElement('div');
            metadata.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 0.8vh;
                margin-bottom: auto;
                position: relative;
                z-index: 1;
            `;

            // Genres
            if (artistData.genres.size > 0) {
                const genresArray = Array.from(artistData.genres).slice(0, 3);
                const genresRow = document.createElement('div');
                genresRow.style.cssText = `
                    font-size: 1.3vw;
                    color: rgba(255,255,255,0.7);
                    font-weight: 500;
                `;
                genresRow.textContent = genresArray.join(', ');
                metadata.appendChild(genresRow);
            }

            // Album count
            const albumCountRow = document.createElement('div');
            albumCountRow.style.cssText = `
                font-size: 1.3vw;
                color: rgba(255,255,255,0.7);
                font-weight: 500;
            `;
            const albumWord = artistData.albums.length === 1 ? 'Album' : 'Albums';
            albumCountRow.textContent = `${artistData.albums.length} ${albumWord}`;
            metadata.appendChild(albumCountRow);

            // Album list with comma separation
            const albumList = document.createElement('div');
            albumList.style.cssText = `
                font-size: 1.1vw;
                color: rgba(255,255,255,0.6);
                line-height: 1.6;
                font-style: italic;
                margin-top: 1vh;
            `;
            const albumTitles = artistData.albums
                .slice(0, 5)
                .map(a => a.title)
                .join(', ');
            albumList.textContent = `"${artistData.albums.length > 5 ? albumTitles + '...' : albumTitles}"`;
            metadata.appendChild(albumList);

            leftSide.appendChild(metadata);

            // BOTTOM - Album Covers Grid (always 4 columns)
            const albumGrid = document.createElement('div');

            albumGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 1vw;
                margin-top: 2vh;
                margin-bottom: 3vh;
                position: relative;
                z-index: 1;
            `;

            // Always show 4 album covers (pick 4 UNIQUE albums, randomized)
            const albumsToShow = [];
            const usedIds = new Set(); // Track unique IDs to prevent duplicates

            if (artistData.albums.length === 0) {
                // No albums - will show empty placeholders
            } else if (artistData.albums.length === 1) {
                // 1 album - show it once
                albumsToShow.push(artistData.albums[0]);
            } else if (artistData.albums.length === 2) {
                // 2 albums - show both (guaranteed unique)
                albumsToShow.push(...artistData.albums);
            } else if (artistData.albums.length === 3) {
                // 3 albums - show all three
                albumsToShow.push(...artistData.albums);
            } else {
                // 4+ albums - pick random UNIQUE albums
                const targetCount = Math.min(4, artistData.albums.length);
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
                albumCover.style.cssText = `
                    width: 100%;
                    aspect-ratio: 1;
                    object-fit: cover;
                    border-radius: 0.6vw;
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

            leftSide.appendChild(albumGrid);

            // Label below grid
            const label = document.createElement('div');
            label.textContent = 'FEATURED ALBUM COVER';
            label.style.cssText = `
                text-align: center;
                font-size: 0.85vw;
                color: rgba(255,255,255,0.4);
                letter-spacing: 0.15em;
                font-weight: 600;
                margin-top: 1.2vh;
                position: relative;
                z-index: 1;
            `;
            leftSide.appendChild(label);

            card.appendChild(leftSide);

            // RIGHT SIDE - Artist Photo (60% width, almost square on 16:9)
            const rightSide = document.createElement('div');
            rightSide.style.cssText = `
                width: 60%;
                height: 100%;
                position: relative;
                overflow: hidden;
            `;

            // Add full artist photo with blue monochrome effect
            if (artistData.photo) {
                const artistPhoto = document.createElement('img');
                artistPhoto.src = artistData.photo;
                artistPhoto.style.cssText = `
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    object-position: center;
                    filter: grayscale(1) brightness(0.3) sepia(1) hue-rotate(180deg) saturate(3);
                `;
                rightSide.appendChild(artistPhoto);
            } else {
                rightSide.style.background = 'linear-gradient(135deg, #2a2a3e 0%, #1a1a2e 100%)';
            }

            card.appendChild(rightSide);

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

            const albumGrid = card.querySelector('div[style*="grid-template-columns"]');
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

            // Rotate albums every 10 seconds
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
            }, 10000); // Every 10 seconds
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
})();
