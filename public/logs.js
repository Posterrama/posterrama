document.addEventListener('DOMContentLoaded', () => {
    const logOutput = document.getElementById('log-output');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const logLevelSelect = document.getElementById('logLevel');
    const pauseButton = document.getElementById('pauseButton');
    const autoScrollCheckbox = document.getElementById('autoScroll');
    const clearFilterButton = document.getElementById('clearFilter');

    let lastLogCount = 0;
    // Track scroll state within checkScroll(); initialized true
    let isScrolledToBottom = true;
    let isPaused = false;
    let currentLogs = [];
    let selectedLevel = logLevelSelect.value;
    let searchText = '';

    // Detect user's locale and preferred time format for timestamp formatting
    const userLocale = navigator.language || navigator.languages?.[0] || 'en-US';

    // Smart 24-hour detection based on multiple factors
    function shouldUse24Hour() {
        // Check if any of the browser languages indicate 24-hour preference
        const allLanguages = navigator.languages || [navigator.language];
        const has24HourLanguage = allLanguages.some(
            lang =>
                lang.startsWith('nl') ||
                lang.startsWith('de') ||
                lang.startsWith('fr') ||
                lang.startsWith('it') ||
                lang.startsWith('es') ||
                lang.startsWith('pt') ||
                lang.startsWith('sv') ||
                lang.startsWith('da') ||
                lang.startsWith('no') ||
                lang.startsWith('fi') ||
                lang.startsWith('ru') ||
                lang.startsWith('pl')
        );

        // Check timezone as location indicator
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const isEuropeanTimezone =
            timezone &&
            (timezone.includes('Europe/') ||
                timezone.includes('Amsterdam') ||
                timezone.includes('Berlin') ||
                timezone.includes('Paris'));

        // Use 24-hour if:
        // 1. Primary language is NOT en-US/en-CA, OR
        // 2. Any browser language suggests 24-hour preference, OR
        // 3. Timezone suggests European location
        return (
            (!userLocale.startsWith('en-US') && !userLocale.startsWith('en-CA')) ||
            has24HourLanguage ||
            isEuropeanTimezone
        );
    }

    const uses24Hour = shouldUse24Hour();

    // Log level hierarchy for filtering (Winston levels)
    const logLevels = {
        silly: 0, // Winston's most verbose level
        debug: 1,
        verbose: 2,
        http: 3,
        info: 4,
        warn: 5,
        error: 6,
    };

    // Function to check if the user is scrolled to the bottom of the log container
    function checkScroll() {
        const container = logOutput.parentElement;
        // A small tolerance (e.g., 5px) can help on some browsers
        isScrolledToBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 5;
    }

    logOutput.parentElement.addEventListener('scroll', checkScroll);

    // Event listeners for controls
    pauseButton.addEventListener('click', () => {
        isPaused = !isPaused;
        if (isPaused) {
            pauseButton.innerHTML = '<i class="fas fa-play"></i> Resume';
        } else {
            pauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
            fetchLogs();
        }
    });

    logLevelSelect.addEventListener('change', e => {
        selectedLevel = e.target.value;
        renderLogs(currentLogs);
    });

    const textFilter = document.getElementById('textFilter');

    textFilter.addEventListener('input', e => {
        searchText = e.target.value.toLowerCase();
        renderLogs(currentLogs);
    });

    clearFilterButton.addEventListener('click', () => {
        logLevelSelect.value = 'silly';
        selectedLevel = 'silly';
        textFilter.value = '';
        searchText = '';
        renderLogs(currentLogs);
    });

    function formatLog(log) {
        const { timestamp, level, message } = log;
        const levelClass = `level-${level.toLowerCase()}`;

        const logEntry = document.createElement('div');
        logEntry.className = 'log-row';

        // Add expand indicator as first element
        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = '▶';

        // Smart timestamp formatting based on user preferences
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';

        // Convert ISO timestamp to readable format
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();

            // Smart time formatting based on user preferences
            const timeOptions = {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: !uses24Hour, // Force 24h for most locales, 12h for US/Canada
            };

            if (isToday) {
                timestampSpan.textContent = date.toLocaleTimeString(userLocale, timeOptions);
            } else {
                timestampSpan.textContent =
                    date.toLocaleDateString(userLocale, {
                        month: 'short',
                        day: 'numeric',
                    }) +
                    ', ' +
                    date.toLocaleTimeString(userLocale, timeOptions);
            }
        } catch (e) {
            timestampSpan.textContent = timestamp;
        }

        const levelSpan = document.createElement('span');
        levelSpan.className = `level ${levelClass}`;
        levelSpan.textContent = level;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'message';
        messageSpan.textContent = message;

        // Create expandable details container (initially hidden)
        const detailsContainer = document.createElement('div');
        detailsContainer.className = 'log-details';
        detailsContainer.style.display = 'none';

        // Add all available log data as formatted details
        const details = [];
        Object.keys(log).forEach(key => {
            if (key !== 'message') {
                // Don't repeat the main message
                const value =
                    typeof log[key] === 'object' ? JSON.stringify(log[key], null, 2) : log[key];
                details.push(`<strong>${key}:</strong> ${value}`);
            }
        });

        // If no extra details available, show helpful message
        if (details.length === 0) {
            details.push('<em>No additional details available for this log entry</em>');
        }

        detailsContainer.innerHTML = `<div class="log-details-content">${details.join('<br>')}</div>`;

        // Add expand/collapse click handler (always add, even if no extra details)
        logEntry.addEventListener('click', e => {
            e.preventDefault();
            const isVisible = detailsContainer.style.display !== 'none';
            detailsContainer.style.display = isVisible ? 'none' : 'block';
            logEntry.classList.toggle('expanded', !isVisible);

            // Rotate the expand icon
            expandIcon.textContent = isVisible ? '▶' : '▼';
        });

        // Add cursor pointer and hover effect
        logEntry.style.cursor = 'pointer';
        logEntry.title = 'Click to expand/collapse details';

        logEntry.appendChild(expandIcon);
        logEntry.appendChild(timestampSpan);
        logEntry.appendChild(levelSpan);
        logEntry.appendChild(messageSpan);
        logEntry.appendChild(detailsContainer);

        return logEntry;
    }

    function shouldShowLog(log) {
        const levelMatch = logLevels[log.level.toLowerCase()] >= logLevels[selectedLevel];
        const textMatch =
            searchText === '' ||
            log.message.toLowerCase().includes(searchText) ||
            log.level.toLowerCase().includes(searchText);
        return levelMatch && textMatch;
    }

    function renderLogs(logs) {
        // Newest-first rendering: reverse order without mutating original array
        const filteredLogs = logs
            .filter(log => shouldShowLog(log))
            .slice()
            .reverse();

        const container = logOutput.parentElement;
        const atTop = container.scrollTop === 0; // when newest-first, top is the latest

        logOutput.innerHTML = '';
        for (const log of filteredLogs) {
            logOutput.appendChild(formatLog(log));
        }

        // Auto-scroll behavior: if user was at top (viewing the latest), keep them at top
        if (autoScrollCheckbox.checked && isScrolledToBottom) {
            if (atTop) {
                container.scrollTop = 0;
            }
        }
    }

    async function fetchLogs() {
        if (isPaused) return;

        try {
            const response = await fetch('/api/admin/logs', {
                credentials: 'include', // Include cookies in the request
                headers: {
                    Accept: 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            const logs = await response.json();

            // Update status indicator
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connected';

            // Only update if logs have changed
            if (
                logs.length !== lastLogCount ||
                JSON.stringify(logs) !== JSON.stringify(currentLogs)
            ) {
                currentLogs = logs;
                lastLogCount = logs.length;
                renderLogs(logs);
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Disconnected';
        }
    }

    // Fetch logs immediately on load, then poll every 5 seconds
    fetchLogs();
    let pollInterval = setInterval(fetchLogs, 5000);

    // Clean up interval when page is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(pollInterval);
        } else {
            // Resume polling when page becomes visible again
            fetchLogs();
            pollInterval = setInterval(fetchLogs, 5000);
        }
    });

    // Log Level Configuration
    const serverLogLevel = document.getElementById('serverLogLevel');
    const updateServerLevel = document.getElementById('updateServerLevel');

    // Fetch current server log level
    async function fetchServerLogLevel() {
        try {
            const response = await fetch('/api/admin/logs/level');
            const data = await response.json();

            if (data.currentLevel && data.availableLevels) {
                // Populate dropdown with available levels
                serverLogLevel.innerHTML = '';
                data.availableLevels.forEach(level => {
                    const option = document.createElement('option');
                    option.value = level;
                    option.textContent = level.toUpperCase();
                    option.selected = level === data.currentLevel;
                    serverLogLevel.appendChild(option);
                });

                serverLogLevel.disabled = false;
                updateServerLevel.disabled = false;
            }
        } catch (error) {
            console.error('Failed to fetch server log level:', error);
            serverLogLevel.innerHTML = '<option>Error loading</option>';
        }
    }

    // Update server log level
    async function updateServerLogLevel() {
        const newLevel = serverLogLevel.value;
        if (!newLevel) return;

        updateServerLevel.disabled = true;
        updateServerLevel.textContent = 'Updating...';

        try {
            const response = await fetch('/api/admin/logs/level', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ level: newLevel }),
            });

            const data = await response.json();

            if (data.success) {
                // Show success message briefly
                updateServerLevel.innerHTML = '<i class="fas fa-check"></i> Updated';
                updateServerLevel.classList.add('btn-success');
                updateServerLevel.classList.remove('btn-primary');

                // Reset button after 2 seconds
                setTimeout(() => {
                    updateServerLevel.innerHTML = '<i class="fas fa-cog"></i> Update';
                    updateServerLevel.classList.remove('btn-success');
                    updateServerLevel.classList.add('btn-primary');
                    updateServerLevel.disabled = false;
                }, 2000);

                // Refresh logs to show new level effects
                setTimeout(fetchLogs, 1000);
            } else {
                throw new Error(data.error || 'Failed to update log level');
            }
        } catch (error) {
            console.error('Failed to update server log level:', error);

            // Show error state
            updateServerLevel.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
            updateServerLevel.classList.add('btn-error');
            updateServerLevel.classList.remove('btn-primary');

            // Reset button after 3 seconds
            setTimeout(() => {
                updateServerLevel.innerHTML = '<i class="fas fa-cog"></i> Update';
                updateServerLevel.classList.remove('btn-error');
                updateServerLevel.classList.add('btn-primary');
                updateServerLevel.disabled = false;
            }, 3000);
        }
    }

    // Event listeners
    updateServerLevel.addEventListener('click', updateServerLogLevel);

    // Fetch server log level on load
    fetchServerLogLevel();
});
