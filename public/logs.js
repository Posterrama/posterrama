document.addEventListener('DOMContentLoaded', () => {
    console.log(
        '🔄 Logs.js v2.2.0 - Smart updates preserve expanded states',
        new Date().toISOString()
    );

    const logOutput = document.getElementById('log-output');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const logLevelSelect = document.getElementById('logLevel');
    const pauseButton = document.getElementById('pauseButton');
    const autoScrollCheckbox = document.getElementById('autoScroll');
    const clearFilterButton = document.getElementById('clearFilter');

    let lastLogCount = 0;
    // Track scroll state within checkScroll(); initialized true
    let _isScrolledToBottom = true; // renamed to silence unused var (logic simplified later)
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

    // Simplified log level hierarchy for filtering
    const logLevels = {
        debug: 1, // Most verbose - shows everything
        info: 2, // Normal operations
        warn: 3, // Warnings
        error: 4, // Errors only
    }; // Function to check if the user is scrolled to the bottom of the log container
    function checkScroll() {
        // Scroll tracking kept for potential future auto-scroll logic
        const container = logOutput.parentElement;
        _isScrolledToBottom =
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
        // Fetch new logs with updated level filter
        fetchLogs();
    });

    const textFilter = document.getElementById('textFilter');

    textFilter.addEventListener('input', e => {
        searchText = e.target.value.toLowerCase();
        renderLogs(currentLogs);
    });

    clearFilterButton.addEventListener('click', () => {
        logLevelSelect.value = 'debug';
        selectedLevel = 'debug';
        textFilter.value = '';
        searchText = '';
        // Fetch new logs with debug level
        fetchLogs();
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

    // Removed unused shouldShowLog; server already filters by level and client re-filters text inline

    function renderLogs(logs) {
        // Since server-side filtering is applied, we only need to apply search filter
        const filteredLogs = logs
            .filter(log => {
                const textMatch =
                    searchText === '' ||
                    log.message.toLowerCase().includes(searchText) ||
                    log.level.toLowerCase().includes(searchText);
                return textMatch;
            })
            .slice()
            .reverse(); // Newest-first rendering

        const container = logOutput.parentElement;
        const wasScrolledToTop = container.scrollTop <= 10; // Allow small threshold for "at top"

        // Smart update: preserve expanded states and only update if content actually changed
        updateLogsSmart(filteredLogs);

        // Auto-scroll behavior: if user was viewing latest logs (at top), keep them there
        if (autoScrollCheckbox.checked && wasScrolledToTop) {
            container.scrollTop = 0;
        }
    }

    function updateLogsSmart(newLogs) {
        // Save currently expanded log IDs
        const expandedLogs = new Set();
        const existingRows = logOutput.querySelectorAll('.log-row.expanded');
        existingRows.forEach(row => {
            const timestamp = row.querySelector('.timestamp')?.textContent;
            const message = row.querySelector('.message')?.textContent;
            if (timestamp && message) {
                expandedLogs.add(`${timestamp}-${message.substring(0, 50)}`);
            }
        });

        // Only rebuild if logs have actually changed
        const currentLogSignature = Array.from(logOutput.querySelectorAll('.log-row'))
            .map(row => {
                const timestamp = row.querySelector('.timestamp')?.textContent || '';
                const message = row.querySelector('.message')?.textContent || '';
                return `${timestamp}-${message.substring(0, 50)}`;
            })
            .join('|');

        const newLogSignature = newLogs
            .map(log => {
                const timestamp = new Date(log.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: !uses24Hour,
                });
                return `${timestamp}-${log.message.substring(0, 50)}`;
            })
            .join('|');

        // If content is the same, don't rebuild
        if (currentLogSignature === newLogSignature) {
            return;
        }

        // Rebuild but restore expanded states
        logOutput.innerHTML = '';
        for (const log of newLogs) {
            const logElement = formatLog(log);
            logOutput.appendChild(logElement);

            // Restore expanded state if it was previously expanded
            const timestamp = logElement.querySelector('.timestamp')?.textContent;
            const message = logElement.querySelector('.message')?.textContent;
            const logId = `${timestamp}-${message?.substring(0, 50)}`;

            if (expandedLogs.has(logId)) {
                logElement.classList.add('expanded');
                const detailsContainer = logElement.querySelector('.log-details');
                if (detailsContainer) {
                    detailsContainer.style.display = 'block';
                }
                const expandIcon = logElement.querySelector('.expand-icon');
                if (expandIcon) {
                    expandIcon.textContent = '−';
                }
            }
        }
    }

    async function fetchLogs() {
        if (isPaused) return;

        try {
            // Send level and limit parameters to server for efficient filtering
            const params = new URLSearchParams({
                level: selectedLevel,
                limit: '500', // Increased limit to see more history
            });

            const response = await fetch(`/api/admin/logs?${params}`, {
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
                JSON.stringify(logs.slice(-5)) !== JSON.stringify(currentLogs.slice(-5)) // Only compare last 5 for performance
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

    // Smart polling: start with longer intervals, then speed up
    let pollCount = 0;
    let pollInterval;

    function getPollingInterval() {
        // First 5 polls (25 seconds): every 5 seconds
        // Next 10 polls (50 seconds): every 5 seconds
        // After that: every 3 seconds for more responsive updates
        if (pollCount < 15) {
            return 5000; // 5 seconds for first 75 seconds
        }
        return 3000; // 3 seconds afterwards
    }

    function startPolling() {
        const interval = getPollingInterval();
        pollInterval = setTimeout(() => {
            pollCount++;
            fetchLogs();
            startPolling(); // Schedule next poll
        }, interval);
    }

    // Fetch logs immediately on load, then start smart polling
    fetchLogs();
    startPolling();

    // Clean up polling when page is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearTimeout(pollInterval);
        } else {
            // Resume polling when page becomes visible again
            fetchLogs();
            startPolling();
        }
    });
});
