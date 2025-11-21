/**
 * Admin Logs Viewer
 * Real-time log viewer component with filtering, search, and export
 */

class LogsViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container #${containerId} not found`);
            return;
        }

        // State
        this.logs = [];
        this.filteredLogs = [];
        this.maxLogs = 1000;
        this.autoScroll = true;
        this.isPaused = false;
        this.unreadCount = 0;
        this.currentLevel = 'ALL';
        this.searchTerm = '';
        this.eventSource = null;

        // Level colors (matching Bootstrap)
        this.levelColors = {
            ERROR: 'danger',
            FATAL: 'danger',
            WARN: 'warning',
            INFO: 'info',
            DEBUG: 'secondary',
            TRACE: 'light',
        };

        this.init();
    }

    init() {
        this.render();
        this.attachEventListeners();
        this.loadHistoricalLogs();
        this.connectSSE();
    }

    render() {
        this.container.innerHTML = `
            <!-- Fixed Controls Bar -->
            <div class="logs-controls bg-dark p-3 rounded-top border-bottom border-secondary">
                    <div class="row g-2 align-items-center">
                        <div class="col-md-4">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text bg-dark text-light border-secondary">
                                    <i class="fas fa-search"></i>
                                </span>
                                <input type="text" 
                                       class="form-control bg-dark text-light border-secondary" 
                                       id="logs-search" 
                                       placeholder="Search logs..."
                                       autocomplete="off">
                                <button class="btn btn-outline-secondary" type="button" id="logs-search-clear">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <div class="col-md-2">
                            <select class="form-select form-select-sm bg-dark text-light border-secondary" id="logs-level-filter">
                                <option value="ALL">All Levels</option>
                                <option value="ERROR">ERROR</option>
                                <option value="WARN">WARN+</option>
                                <option value="INFO">INFO+</option>
                                <option value="DEBUG">DEBUG+</option>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-outline-success" id="logs-auto-scroll" title="Auto-scroll (Space)">
                                    <i class="fas fa-arrow-down"></i>
                                    <span class="d-none d-lg-inline">Auto-scroll</span>
                                </button>
                                <button class="btn btn-outline-warning" id="logs-pause" title="Pause (Space)">
                                    <i class="fas fa-pause"></i>
                                    <span class="d-none d-lg-inline">Pause</span>
                                </button>
                                <button class="btn btn-outline-info" id="logs-export-txt" title="Export Diagnostics">
                                    <i class="fas fa-file-download"></i>
                                    <span class="d-none d-lg-inline">Export</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col">
                            <small class="text-muted">
                                <span id="logs-status">
                                    <i class="fas fa-circle text-secondary"></i> Connecting...
                                </span>
                                <span class="ms-3">
                                    <i class="fas fa-list"></i> 
                                    <span id="logs-count">0</span> logs
                                </span>
                                <span class="ms-3" id="logs-unread-badge" style="display: none;">
                                    <i class="fas fa-bell"></i>
                                    <span class="badge bg-primary" id="logs-unread-count">0</span> unread
                                </span>
                            </small>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Scrollable Logs Container -->
            <div class="logs-viewer">
                <div class="logs-container bg-dark rounded-bottom" id="logs-display">
                    <div class="text-center text-muted p-4">
                        <i class="fas fa-spinner fa-spin fa-2x mb-3"></i>
                        <p>Loading logs...</p>
                    </div>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Search
        const searchInput = document.getElementById('logs-search');
        const searchClear = document.getElementById('logs-search-clear');
        searchInput?.addEventListener('input', e => {
            this.searchTerm = e.target.value;
            this.applyFilters();
        });
        searchClear?.addEventListener('click', () => {
            searchInput.value = '';
            this.searchTerm = '';
            this.applyFilters();
        });

        // Level filter
        document.getElementById('logs-level-filter')?.addEventListener('change', e => {
            this.currentLevel = e.target.value;
            this.applyFilters();
        });

        // Auto-scroll toggle
        document.getElementById('logs-auto-scroll')?.addEventListener('click', () => {
            this.autoScroll = !this.autoScroll;
            this.updateButtonStates();
            if (this.autoScroll) {
                this.scrollToBottom();
                this.unreadCount = 0;
                this.updateUnreadBadge();
            }
        });

        // Pause toggle
        document.getElementById('logs-pause')?.addEventListener('click', () => {
            this.togglePause();
        });

        // Export button
        document.getElementById('logs-export-txt')?.addEventListener('click', () => {
            this.exportLogs('txt');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                // Clear search
                searchInput.value = '';
                this.searchTerm = '';
                this.applyFilters();
            } else if (e.key === ' ') {
                // Toggle pause
                e.preventDefault();
                this.togglePause();
            }
        });

        // Detect manual scrolling
        const logsDisplay = document.getElementById('logs-display');
        logsDisplay?.addEventListener('scroll', () => {
            const isAtBottom =
                logsDisplay.scrollHeight - logsDisplay.scrollTop <= logsDisplay.clientHeight + 50;
            if (this.autoScroll && !isAtBottom) {
                this.autoScroll = false;
                this.updateButtonStates();
            } else if (!this.autoScroll && isAtBottom) {
                this.autoScroll = true;
                this.unreadCount = 0;
                this.updateUnreadBadge();
                this.updateButtonStates();
            }
        });
    }

    async loadHistoricalLogs() {
        try {
            const response = await fetch('/api/admin/logs?limit=1000');
            const data = await response.json();

            if (data.success && data.logs) {
                this.logs = data.logs;
                this.applyFilters();
            }
        } catch (error) {
            console.error('Failed to load historical logs:', error);
            this.updateStatus('error', 'Failed to load logs');
        }
    }

    connectSSE() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource('/api/admin/logs/stream');

        this.eventSource.onopen = () => {
            this.updateStatus('connected', 'Connected');
        };

        this.eventSource.onmessage = event => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'connected') {
                    this.updateStatus('connected', 'Connected');
                } else if (message.type === 'log') {
                    this.addLog(message.data);
                } else if (message.type === 'heartbeat') {
                    // Keep-alive, no action needed
                }
            } catch (error) {
                console.error('Error parsing SSE message:', error);
            }
        };

        this.eventSource.onerror = () => {
            this.updateStatus('error', 'Connection lost. Reconnecting...');
            this.eventSource.close();
            setTimeout(() => this.connectSSE(), 5000);
        };
    }

    addLog(log) {
        if (this.isPaused) return;

        // Add to logs array
        this.logs.push(log);

        // Maintain max logs limit
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Update unread count if not at bottom
        if (!this.autoScroll) {
            this.unreadCount++;
            this.updateUnreadBadge();
        }

        // Apply filters and render
        this.applyFilters();
    }

    applyFilters() {
        let filtered = [...this.logs];

        // Apply level filter
        if (this.currentLevel !== 'ALL') {
            const levelHierarchy = {
                ERROR: ['ERROR', 'FATAL'],
                WARN: ['ERROR', 'FATAL', 'WARN'],
                INFO: ['ERROR', 'FATAL', 'WARN', 'INFO'],
                DEBUG: ['ERROR', 'FATAL', 'WARN', 'INFO', 'DEBUG', 'TRACE'],
            };
            const allowedLevels = levelHierarchy[this.currentLevel] || [];
            filtered = filtered.filter(log => allowedLevels.includes(log.level));
        }

        // Apply search filter
        if (this.searchTerm) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(
                log =>
                    log.message.toLowerCase().includes(searchLower) ||
                    log.level.toLowerCase().includes(searchLower)
            );
        }

        this.filteredLogs = filtered;
        this.renderLogs();
    }

    renderLogs() {
        const logsDisplay = document.getElementById('logs-display');
        if (!logsDisplay) return;

        // Save expanded state before re-rendering (using timestamp as unique ID)
        const expandedTimestamps = new Set();
        document.querySelectorAll('.log-expandable').forEach(entry => {
            const details = entry.querySelector('.log-details');
            if (details && details.style.display === 'block') {
                const timestampEl = entry.querySelector('.log-summary .text-muted');
                if (timestampEl) {
                    expandedTimestamps.add(timestampEl.textContent);
                }
            }
        });

        if (this.filteredLogs.length === 0) {
            logsDisplay.innerHTML = `
                <div class="text-center text-muted p-4">
                    <i class="fas fa-inbox fa-2x mb-3"></i>
                    <p>No logs to display</p>
                </div>
            `;
            this.updateLogsCount();
            return;
        }

        // Build HTML for all logs (newest first)
        const html = this.filteredLogs
            .slice()
            .reverse()
            .map((log, index) => {
                const levelColor = this.levelColors[log.level] || 'secondary';
                const timestamp = new Date(log.timestamp).toLocaleTimeString('en-GB', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    fractionalSecondDigits: 3,
                });

                // Full ISO timestamp for expanded view
                const fullTimestamp = new Date(log.timestamp).toISOString();

                // Handle multiline messages (e.g., stack traces)
                const messageLines = log.message.split('\n');
                const firstLine = this.escapeHtml(messageLines[0]);
                const additionalLines = messageLines
                    .slice(1)
                    .map(line => `<div class="ms-4 text-muted">${this.escapeHtml(line)}</div>`)
                    .join('');

                // Build metadata/details for expanded view (all properties except timestamp, level, message)
                const metadata = [];
                Object.entries(log).forEach(([key, value]) => {
                    // Skip timestamp, level, message AND numeric keys (those are string character indices)
                    if (
                        !['timestamp', 'level', 'message'].includes(key) &&
                        value !== undefined &&
                        value !== null &&
                        isNaN(parseInt(key))
                    ) {
                        // Skip numeric indices like "0", "1", "2"
                        const valueStr =
                            typeof value === 'object'
                                ? JSON.stringify(value, null, 2)
                                : String(value);
                        metadata.push(
                            `<div class="ms-4 text-muted"><strong>${this.escapeHtml(key)}:</strong> ${this.escapeHtml(valueStr)}</div>`
                        );
                    }
                });

                // Check if this log should be expanded (based on saved state)
                const shouldExpand = expandedTimestamps.has(timestamp);
                const detailsDisplay = shouldExpand ? 'block' : 'none';
                const iconRotation = shouldExpand ? 'rotate(90deg)' : 'rotate(0deg)';

                return `
                    <div class="log-entry log-expandable" data-level="${log.level}" data-log-index="${index}" style="cursor: pointer;">
                        <div class="log-summary">
                            <i class="fas fa-chevron-right expand-icon me-2" style="font-size: 10px; color: rgba(255,255,255,0.4); transition: transform 0.2s; transform: ${iconRotation};"></i>
                            <span class="text-muted">${timestamp}</span>
                            <span class="badge bg-${levelColor} ms-2">${log.level}</span>
                            <span class="ms-2 text-light">${firstLine}</span>
                        </div>
                        <div class="log-details" style="display: ${detailsDisplay}; margin-top: 8px; padding-left: 24px; border-left: 2px solid rgba(255,255,255,0.1);">
                            <div class="ms-4 text-muted"><strong>Timestamp:</strong> ${fullTimestamp}</div>
                            <div class="ms-4 text-muted"><strong>Level:</strong> ${log.level}</div>
                            <div class="ms-4 text-muted"><strong>Message:</strong> ${this.escapeHtml(log.message)}</div>
                            ${metadata.join('')}
                            ${additionalLines}
                        </div>
                    </div>
                `;
            })
            .join('');

        logsDisplay.innerHTML = html;

        // Add click handlers for expandable logs
        document.querySelectorAll('.log-expandable').forEach(logEntry => {
            logEntry.addEventListener('click', e => {
                // Don't expand if clicking on a link or button
                if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;

                const details = logEntry.querySelector('.log-details');
                const icon = logEntry.querySelector('.expand-icon');

                if (details.style.display === 'none') {
                    details.style.display = 'block';
                    icon.style.transform = 'rotate(90deg)';
                } else {
                    details.style.display = 'none';
                    icon.style.transform = 'rotate(0deg)';
                }
            });
        });

        // Auto-scroll to top if enabled (newest logs are at top)
        if (this.autoScroll) {
            this.scrollToTop();
        }

        this.updateLogsCount();
    }

    scrollToTop() {
        const logsDisplay = document.getElementById('logs-display');
        if (logsDisplay) {
            logsDisplay.scrollTop = 0;
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.updateButtonStates();
    }

    updateButtonStates() {
        const autoScrollBtn = document.getElementById('logs-auto-scroll');
        const pauseBtn = document.getElementById('logs-pause');

        if (autoScrollBtn) {
            autoScrollBtn.classList.toggle('active', this.autoScroll);
            autoScrollBtn.innerHTML = this.autoScroll
                ? '<i class="fas fa-arrow-down"></i><span class="d-none d-lg-inline"> Auto-scroll</span>'
                : '<i class="fas fa-arrow-up"></i><span class="d-none d-lg-inline"> Manual</span>';
        }

        if (pauseBtn) {
            pauseBtn.classList.toggle('active', this.isPaused);
            pauseBtn.innerHTML = this.isPaused
                ? '<i class="fas fa-play"></i><span class="d-none d-lg-inline"> Resume</span>'
                : '<i class="fas fa-pause"></i><span class="d-none d-lg-inline"> Pause</span>';
        }
    }

    updateStatus(type, message) {
        const statusEl = document.getElementById('logs-status');
        if (!statusEl) return;

        const icons = {
            connected: '<i class="fas fa-circle text-success"></i>',
            error: '<i class="fas fa-circle text-danger"></i>',
            disconnected: '<i class="fas fa-circle text-secondary"></i>',
        };

        statusEl.innerHTML = `${icons[type] || icons.disconnected} ${message}`;
    }

    updateLogsCount() {
        const countEl = document.getElementById('logs-count');
        if (countEl) {
            countEl.textContent = this.filteredLogs.length;
        }
    }

    updateUnreadBadge() {
        const badgeContainer = document.getElementById('logs-unread-badge');
        const badgeCount = document.getElementById('logs-unread-count');

        if (badgeContainer && badgeCount) {
            if (this.unreadCount > 0) {
                badgeContainer.style.display = 'inline';
                badgeCount.textContent = this.unreadCount;
            } else {
                badgeContainer.style.display = 'none';
            }
        }
    }

    async exportLogs(format) {
        try {
            const url = `/api/admin/logs/download?format=${format}`;
            const response = await fetch(url);

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;

            // Use descriptive filenames
            const date = new Date().toISOString().split('T')[0];
            if (format === 'json') {
                a.download = `posterrama-logs-${date}.json`;
            } else {
                a.download = `posterrama-diagnostics-${date}.txt`;
            }

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export logs');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        if (this.eventSource) {
            this.eventSource.close();
        }
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('logs-viewer-container')) {
            window.logsViewer = new LogsViewer('logs-viewer-container');
        }
    });
} else {
    if (document.getElementById('logs-viewer-container')) {
        window.logsViewer = new LogsViewer('logs-viewer-container');
    }
}
