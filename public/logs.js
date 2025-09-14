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

    // Log level hierarchy for filtering
    const logLevels = {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
        fatal: 5,
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
        logLevelSelect.value = 'trace';
        selectedLevel = 'trace';
        textFilter.value = '';
        searchText = '';
        renderLogs(currentLogs);
    });

    function formatLog(log) {
        const { timestamp, level, message } = log;
        const levelClass = `level-${level.toLowerCase()}`;

        const logEntry = document.createElement('div');
        logEntry.className = 'log-row';

        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = timestamp;

        const levelSpan = document.createElement('span');
        levelSpan.className = `level ${levelClass}`;
        levelSpan.textContent = level;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'message';
        messageSpan.textContent = message;

        logEntry.appendChild(timestampSpan);
        logEntry.appendChild(levelSpan);
        logEntry.appendChild(messageSpan);

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
});
