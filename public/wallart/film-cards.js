/**
 * Film Cards Module - Director/Genre/Actor spotlight for movies
 * Fullscreen animated cards showing grouped films (like artist-cards for music)
 */

(function () {
    'use strict';

    window.FilmCards = {
        /**
         * Initialize film cards display
         * @param {object} params - Configuration parameters
         * @returns {object} State object with currentPosters and usedPosters
         */
        initialize(params) {
            console.log('[Film Cards] Initialize called with:', {
                hasContainer: !!params.container,
                mediaCount: params.mediaQueue?.length || 0,
                hasConfig: !!params.appConfig,
            });

            const { container, mediaQueue = [], appConfig = {} } = params;

            if (!container || !mediaQueue.length) {
                console.log('[Film Cards] Early return - no container or media');
                return { currentPosters: [], usedPosters: new Set() };
            }

            // Inject CSS animations
            if (!document.getElementById('film-cards-animations')) {
                const style = document.createElement('style');
                style.id = 'film-cards-animations';
                style.textContent = `
                    @keyframes filmCardFadeIn {
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes posterRotate {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Get film cards config
            const filmCardsCfg = appConfig?.wallartMode?.layoutSettings?.filmCards || {};
            const groupBy = filmCardsCfg.groupBy || 'director';
            const minGroupSize = parseInt(filmCardsCfg.minGroupSize) || 3;
            const cardRotationSeconds = parseInt(filmCardsCfg.cardRotationSeconds) || 60;
            const posterRotationSeconds = parseInt(filmCardsCfg.posterRotationSeconds) || 15;

            console.log('[Film Cards] Config:', {
                groupBy,
                minGroupSize,
                cardRotationSeconds,
                posterRotationSeconds,
            });

            // Group films by selected criteria
            let groupsMap;
            switch (groupBy) {
                case 'director':
                    groupsMap = this.groupByDirector(mediaQueue, minGroupSize);
                    break;
                case 'genre':
                    groupsMap = this.groupByGenre(mediaQueue, minGroupSize);
                    break;
                case 'actor':
                    groupsMap = this.groupByActor(mediaQueue, minGroupSize);
                    break;
                case 'random':
                default:
                    // Random: pick random groupBy each time
                    const modes = ['director', 'genre', 'actor'];
                    const randomMode = modes[Math.floor(Math.random() * modes.length)];
                    console.log('[Film Cards] Random mode selected:', randomMode);
                    if (randomMode === 'director') {
                        groupsMap = this.groupByDirector(mediaQueue, minGroupSize);
                    } else if (randomMode === 'genre') {
                        groupsMap = this.groupByGenre(mediaQueue, minGroupSize);
                    } else {
                        groupsMap = this.groupByActor(mediaQueue, minGroupSize);
                    }
                    break;
            }

            let groups = Array.from(groupsMap.values());
            console.log('[Film Cards] Grouped into', groups.length, 'groups');

            if (groups.length === 0) {
                console.warn('[Film Cards] No groups found after grouping');
                return { currentPosters: [], usedPosters: new Set() };
            }

            // Shuffle groups randomly
            groups = groups.sort(() => Math.random() - 0.5);
            console.log('[Film Cards] Groups shuffled randomly');

            // Clear container and set up fullscreen layout
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

            // Show 1 group at a time
            let currentGroupIndex = 0;
            let currentCard = null;

            const showGroup = () => {
                console.log('[Film Cards] Showing group', currentGroupIndex);
                container.innerHTML = '';

                const groupData = groups[currentGroupIndex];
                console.log('[Film Cards] Creating card for group:', groupData.name);
                currentCard = this.createFilmCard(groupData, groupBy);
                container.appendChild(currentCard);

                // Start poster rotation for this group's card
                this.startPosterRotation(currentCard, groupData, posterRotationSeconds);
            };

            // Initial display
            console.log('[Film Cards] Starting initial display');
            showGroup();

            // Rotate to next group
            setInterval(() => {
                currentGroupIndex = (currentGroupIndex + 1) % groups.length;
                showGroup();
            }, cardRotationSeconds * 1000);

            // Track all films from all groups
            groups.forEach(groupData => {
                groupData.films.forEach(film => {
                    currentPosters.push(film);
                    usedPosters.add(film.key || film.id);
                });
            });

            return { currentPosters, usedPosters };
        },

        /**
         * Group films by director
         * @param {array} films - Array of film objects
         * @param {number} minSize - Minimum group size
         * @returns {Map} Map of director name to group data
         */
        groupByDirector(mediaQueue, minSize) {
            const groupMap = new Map();

            console.log('[Film Cards] Grouping', mediaQueue.length, 'films by director');

            const validItems = mediaQueue.filter(item => item != null);
            console.log('[Film Cards] Valid items after filtering:', validItems.length);

            validItems.forEach(item => {
                // Get directors array (can have multiple directors)
                const directors = item.directors || [];
                if (directors.length === 0) return;

                // Use first director as primary
                const directorName = directors[0];

                if (!groupMap.has(directorName)) {
                    groupMap.set(directorName, {
                        name: directorName,
                        films: [],
                        backdrop: null,
                        genres: new Set(),
                    });
                }

                const groupData = groupMap.get(directorName);
                groupData.films.push(item);

                // Use backdrop from highest rated film
                if (!groupData.backdrop || (item.rating && item.rating > 7.5)) {
                    groupData.backdrop = item.backdropUrl || item.backgroundArt;
                }

                // Collect genres
                if (item.genres && Array.isArray(item.genres)) {
                    item.genres.forEach(g => groupData.genres.add(g));
                }
            });

            // Filter by minimum group size
            const filtered = new Map();
            groupMap.forEach((data, name) => {
                if (data.films.length >= minSize) {
                    filtered.set(name, data);
                }
            });

            console.log(
                `[Film Cards] Directors: ${groupMap.size} total, ${filtered.size} after min size filter (${minSize})`
            );

            return filtered;
        },

        /**
         * Group films by genre
         * @param {array} films - Array of film objects
         * @param {number} minSize - Minimum group size
         * @returns {Map} Map of genre name to group data
         */
        groupByGenre(mediaQueue, minSize) {
            const groupMap = new Map();

            console.log('[Film Cards] Grouping', mediaQueue.length, 'films by genre');

            const validItems = mediaQueue.filter(item => item != null);

            validItems.forEach(item => {
                const genres = item.genres || [];
                if (genres.length === 0) return;

                // Use first genre as primary
                const genreName = genres[0];

                if (!groupMap.has(genreName)) {
                    groupMap.set(genreName, {
                        name: genreName,
                        films: [],
                        backdrop: null,
                        genres: new Set([genreName]),
                    });
                }

                const groupData = groupMap.get(genreName);
                groupData.films.push(item);

                // Use backdrop from highest rated film
                if (!groupData.backdrop || (item.rating && item.rating > 7.5)) {
                    groupData.backdrop = item.backdropUrl || item.backgroundArt;
                }
            });

            // Filter by minimum group size
            const filtered = new Map();
            groupMap.forEach((data, name) => {
                if (data.films.length >= minSize) {
                    filtered.set(name, data);
                }
            });

            console.log(
                `[Film Cards] Genres: ${groupMap.size} total, ${filtered.size} after min size filter (${minSize})`
            );

            return filtered;
        },

        /**
         * Group films by actor
         * @param {array} films - Array of film objects
         * @param {number} minSize - Minimum group size
         * @returns {Map} Map of actor name to group data
         */
        groupByActor(mediaQueue, minSize) {
            const groupMap = new Map();

            console.log('[Film Cards] Grouping', mediaQueue.length, 'films by actor');

            const validItems = mediaQueue.filter(item => item != null);

            validItems.forEach(item => {
                const cast = item.cast || [];
                if (cast.length === 0) return;

                // Use first cast member as primary
                const actorName = cast[0].name || cast[0];

                if (!groupMap.has(actorName)) {
                    groupMap.set(actorName, {
                        name: actorName,
                        films: [],
                        backdrop: null,
                        photo: null,
                        genres: new Set(),
                    });
                } else {
                    // Update photo if we didn't have one yet
                    const existingData = groupMap.get(actorName);
                    if (!existingData.photo && cast[0].thumbUrl) {
                        existingData.photo = cast[0].thumbUrl;
                    }
                }

                const groupData = groupMap.get(actorName);
                groupData.films.push(item);

                // Store actor photo from first film with thumbnail
                if (!groupData.photo && cast[0].thumbUrl) {
                    groupData.photo = cast[0].thumbUrl;
                }

                // Use backdrop from highest rated film
                if (!groupData.backdrop || (item.rating && item.rating > 7.5)) {
                    groupData.backdrop = item.backdropUrl || item.backgroundArt;
                }

                // Collect genres
                if (item.genres && Array.isArray(item.genres)) {
                    item.genres.forEach(g => groupData.genres.add(g));
                }
            });

            // Filter by minimum group size
            const filtered = new Map();
            groupMap.forEach((data, name) => {
                if (data.films.length >= minSize) {
                    filtered.set(name, data);
                }
            });

            console.log(
                `[Film Cards] Actors: ${groupMap.size} total, ${filtered.size} after min size filter (${minSize})`
            );

            return filtered;
        },

        /**
         * Create a single film card
         * @param {object} groupData - Group data with films
         * @param {string} groupBy - Group type (director/genre/actor)
         * @returns {HTMLElement} Card element
         */
        createFilmCard(groupData, groupBy) {
            // Detect portrait orientation
            const isPortrait = window.innerHeight > window.innerWidth;

            const card = document.createElement('div');
            card.className = 'film-card';
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
                animation: filmCardFadeIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            `;

            // Background layer: Two versions of the same backdrop
            if (groupData.backdrop) {
                if (isPortrait) {
                    // Portrait: Top section with blue monochrome effect (35%)
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

                    const bluePhoto = document.createElement('img');
                    bluePhoto.src = groupData.backdrop;
                    bluePhoto.style.cssText = `
                        width: 100%;
                        height: 285%;
                        object-fit: cover;
                        object-position: center top;
                        filter: grayscale(100%) contrast(1.1);
                    `;
                    blueContainer.appendChild(bluePhoto);

                    const blueOverlay = document.createElement('div');
                    blueOverlay.style.cssText = `
                        position: absolute;
                        inset: 0;
                        background: rgba(20, 60, 140, 0.75);
                        mix-blend-mode: multiply;
                        pointer-events: none;
                    `;
                    blueContainer.appendChild(blueOverlay);

                    card.appendChild(blueContainer);

                    // Bottom section: Original colors (65%)
                    const originalPhoto = document.createElement('img');
                    originalPhoto.src = groupData.backdrop;
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
                    // Landscape: Left blue (40%), right original (60%)
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

                    const bluePhoto = document.createElement('img');
                    bluePhoto.src = groupData.backdrop;
                    bluePhoto.style.cssText = `
                        width: 250%;
                        height: 100%;
                        object-fit: cover;
                        object-position: left center;
                        filter: grayscale(100%) contrast(1.1);
                    `;
                    blueContainer.appendChild(bluePhoto);

                    const blueOverlay = document.createElement('div');
                    blueOverlay.style.cssText = `
                        position: absolute;
                        inset: 0;
                        background: rgba(20, 60, 140, 0.75);
                        mix-blend-mode: multiply;
                        pointer-events: none;
                    `;
                    blueContainer.appendChild(blueOverlay);

                    card.appendChild(blueContainer);

                    // Right side: Original colors (60%)
                    const originalPhoto = document.createElement('img');
                    originalPhoto.src = groupData.backdrop;
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

            // Group Name - responsive font size
            const groupName = document.createElement('div');
            groupName.textContent = groupData.name;
            groupName.style.cssText = isPortrait
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
            infoSection.appendChild(groupName);

            // Group Type Label
            const typeLabel = document.createElement('div');
            const typeLabelText =
                groupBy === 'director' ? 'Director' : groupBy === 'genre' ? 'Genre' : 'Actor';
            typeLabel.textContent = typeLabelText;
            typeLabel.style.cssText = isPortrait
                ? `
                font-size: 3vw;
                color: rgba(255,255,255,0.5);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                margin-bottom: 2vh;
                position: relative;
                z-index: 2;
            `
                : `
                font-size: 1.2vw;
                color: rgba(255,255,255,0.5);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                margin-bottom: 2vh;
                position: relative;
                z-index: 2;
            `;
            infoSection.appendChild(typeLabel);

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

            // Genres (if not grouping by genre)
            if (groupBy !== 'genre' && groupData.genres.size > 0) {
                const genresArray = Array.from(groupData.genres).slice(0, 3);
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

            // Film count
            const filmCountRow = document.createElement('div');
            filmCountRow.style.cssText = isPortrait
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
            const filmWord = groupData.films.length === 1 ? 'Film' : 'Films';
            filmCountRow.textContent = `${groupData.films.length} ${filmWord}`;
            metadata.appendChild(filmCountRow);

            // Film list (landscape only, skip on portrait)
            if (!isPortrait) {
                const filmList = document.createElement('div');
                filmList.style.cssText = `
                    font-size: 1.1vw;
                    color: rgba(255,255,255,0.6);
                    line-height: 1.6;
                    font-style: italic;
                    margin-top: 1vh;
                    padding-right: 2vw;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                `;
                const filmTitles = groupData.films
                    .slice(0, 5)
                    .map(f => f.title)
                    .join(', ');
                filmList.textContent = `"${groupData.films.length > 5 ? filmTitles + '...' : filmTitles}"`;
                metadata.appendChild(filmList);
            }

            infoSection.appendChild(metadata);
            card.appendChild(infoSection);

            // POSTER SECTION
            const posterSection = document.createElement('div');
            posterSection.style.cssText = isPortrait
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
            card.appendChild(posterSection);

            // BOTTOM - Poster Grid (full width at bottom)
            const posterGrid = document.createElement('div');
            posterGrid.className = 'film-poster-grid';

            const maxPosters = isPortrait ? 5 : 8;
            const gridGap = isPortrait ? '2vw' : '1.5vw';

            posterGrid.style.cssText = isPortrait
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

            // Show up to maxPosters (pick UNIQUE films, randomized)
            const postersToShow = [];
            const usedIds = new Set();
            const targetCount = Math.min(maxPosters, groupData.films.length);

            if (groupData.films.length === 0) {
                // No films
            } else {
                const shuffled = [...groupData.films].sort(() => Math.random() - 0.5);

                for (const film of shuffled) {
                    if (postersToShow.length >= targetCount) break;

                    const filmId = film.id || film.key || film.posterUrl;
                    if (!usedIds.has(filmId)) {
                        postersToShow.push(film);
                        usedIds.add(filmId);
                    }
                }
            }

            const visiblePosters = postersToShow;
            visiblePosters.forEach((film, idx) => {
                const posterImg = document.createElement('img');
                posterImg.src = film.posterUrl || '';
                posterImg.alt = film.title || '';

                const gapsCount = maxPosters - 1;
                const gapValue = isPortrait ? 2 : 1.5;
                const posterWidth = `calc((100% - (${gapsCount} * ${gapValue}vw)) / ${maxPosters})`;

                posterImg.style.cssText = `
                    width: ${posterWidth};
                    aspect-ratio: 2/3;
                    flex-shrink: 0;
                    object-fit: cover;
                    border-radius: ${isPortrait ? '1vw' : '0.6vw'};
                    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                    opacity: 0;
                    animation: posterFadeIn 0.6s ease forwards;
                    animation-delay: ${0.3 + idx * 0.1}s;
                `;
                posterImg.onerror = () => {
                    posterImg.style.background =
                        'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)';
                };
                posterGrid.appendChild(posterImg);
            });

            card.appendChild(posterGrid);

            return card;
        },

        /**
         * Start automatic poster rotation for a film card
         * @param {HTMLElement} card - The film card element
         * @param {object} groupData - Group data with films array
         * @param {number} rotationSeconds - Rotation interval in seconds
         */
        startPosterRotation(card, groupData, rotationSeconds) {
            if (!groupData.films || groupData.films.length <= 1) {
                console.log('[Film Cards] Not enough films to rotate for', groupData.name);
                return;
            }

            const posterGrid = card.querySelector('.film-poster-grid');
            if (!posterGrid) {
                console.warn('[Film Cards] Could not find poster grid');
                return;
            }

            const allFilms = [...groupData.films];

            const getCurrentlyVisibleIds = () => {
                const posterImgs = posterGrid.querySelectorAll('img');
                const ids = new Set();
                posterImgs.forEach(img => {
                    const src = img.src;
                    if (src) ids.add(src);
                });
                return ids;
            };

            console.log(
                '[Film Cards] Starting poster rotation for',
                groupData.name,
                '-',
                allFilms.length,
                'total films'
            );

            const rotationInterval = setInterval(() => {
                if (!card.isConnected) {
                    clearInterval(rotationInterval);
                    return;
                }

                const posterImgs = posterGrid.querySelectorAll('img');
                if (posterImgs.length === 0) return;

                const visibleUrls = getCurrentlyVisibleIds();
                const availableFilms = allFilms.filter(film => !visibleUrls.has(film.posterUrl));

                if (availableFilms.length === 0) {
                    console.log('[Film Cards] All films currently visible, skipping rotation');
                    return;
                }

                const nextFilms = [];
                const usedInRotation = new Set();

                for (let i = 0; i < posterImgs.length; i++) {
                    const stillAvailable = availableFilms.filter(
                        film => !usedInRotation.has(film.posterUrl)
                    );

                    if (stillAvailable.length > 0) {
                        const randomIndex = Math.floor(Math.random() * stillAvailable.length);
                        const chosen = stillAvailable[randomIndex];
                        nextFilms.push(chosen);
                        usedInRotation.add(chosen.posterUrl);
                    } else {
                        const randomIndex = Math.floor(Math.random() * availableFilms.length);
                        nextFilms.push(availableFilms[randomIndex]);
                    }
                }

                posterImgs.forEach((img, idx) => {
                    if (idx >= nextFilms.length) return;

                    const nextFilm = nextFilms[idx];

                    setTimeout(() => {
                        img.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                        img.style.opacity = '0';
                        img.style.transform = 'scale(0.9)';

                        setTimeout(() => {
                            img.src = nextFilm.posterUrl || '';
                            img.alt = nextFilm.title || '';

                            setTimeout(() => {
                                img.style.opacity = '1';
                                img.style.transform = 'scale(1)';
                            }, 50);
                        }, 400);
                    }, idx * 150);
                });
            }, rotationSeconds * 1000);
        },
    };

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes filmCardFadeIn {
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        
        @keyframes posterFadeIn {
            to {
                opacity: 1;
            }
        }
        
        .film-card {
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease;
        }
        
        .film-card:hover {
            transform: translateY(-8px) scale(1.02);
            box-shadow: 0 24px 64px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.15);
        }
        
        .film-card img {
            transition: opacity 0.3s ease;
        }
    `;
    document.head.appendChild(style);
})();
