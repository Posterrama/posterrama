document.addEventListener('DOMContentLoaded', () => {
    const logOutput = document.getElementById('log-output');
    const logContainer = document.querySelector('.log-container');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    let autoScroll = true;
    let refreshInterval = 2000; // Refresh every 2 seconds
    let lastLogCount = 0;

    // Check if user has scrolled up
    logContainer.addEventListener('scroll', () => {
        // If the user scrolls up from the bottom, disable auto-scrolling
        const scrollThreshold = 10;
        if (logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight > scrollThreshold) {
            autoScroll = false;
        } else {
            autoScroll = true;
        }
    });

    async function fetchAndDisplayLogs() {
        try {
            const response = await fetch('/api/admin/logs');
            if (!response.ok) {
                throw new Error(`Server returned status ${response.status}`);
            }
            const logs = await response.json();

            // Update status indicator
            statusDot.classList.add('connected');
            statusDot.classList.remove('disconnected');
            statusText.textContent = 'Connected';

            // Only re-render if the logs have changed
            if (logs.length !== lastLogCount || logs.length === 0) {
                logOutput.innerHTML = ''; // Clear previous logs

                if (logs.length === 0) {
                    logOutput.textContent = 'No logs available yet.';
                } else {
                    logs.forEach(log => {
                        const line = document.createElement('span');
                        line.className = `log-line level-${log.level.toLowerCase()}`;

                        const timestamp = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        const text = `[${timestamp}] [${log.level}] ${log.message}`;
                        line.textContent = text;
                        logOutput.appendChild(line);
                    });
                }
                lastLogCount = logs.length;

                // Scroll to the bottom if auto-scroll is enabled
                if (autoScroll) {
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            statusDot.classList.add('disconnected');
            statusDot.classList.remove('connected');
            statusText.textContent = 'Disconnected';
        }
    }

    // Initial fetch
    fetchAndDisplayLogs();

    // Set up auto-refresh
    setInterval(fetchAndDisplayLogs, refreshInterval);
});