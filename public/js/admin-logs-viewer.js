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
            <div class="logs-viewer">
                <!-- Controls Bar -->
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
                        <div class="col-md-6 text-end">
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-outline-success" id="logs-auto-scroll" title="Auto-scroll (Space)">
                                    <i class="fas fa-arrow-down"></i>
                                    <span class="d-none d-lg-inline">Auto-scroll</span>
                                </button>
                                <button class="btn btn-outline-warning" id="logs-pause" title="Pause (Space)">
                                    <i class="fas fa-pause"></i>
                                    <span class="d-none d-lg-inline">Pause</span>
                                </button>
                                <button class="btn btn-outline-info" id="logs-export-txt" title="Export as .txt">
                                    <i class="fas fa-file-download"></i>
                                    <span class="d-none d-lg-inline">.txt</span>
                                </button>
                                <button class="btn btn-outline-info" id="logs-export-json" title="Export as .json">
                                    <i class="fas fa-file-code"></i>
                                    <span class="d-none d-lg-inline">.json</span>
                                </button>
                                <button class="btn btn-outline-danger" id="logs-clear" title="Clear display">
                                    <i class="fas fa-trash"></i>
                                    <span class="d-none d-lg-inline">Clear</span>
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

                <!-- Logs Container -->
                <div class="logs-container bg-dark rounded-bottom" id="logs-display" style="height: 600px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 13px;">
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

        // Export buttons
        document.getElementById('logs-export-txt')?.addEventListener('click', () => {
            this.exportLogs('txt');
        });
        document.getElementById('logs-export-json')?.addEventListener('click', () => {
            this.exportLogs('json');
        });

        // Clear button
        document.getElementById('logs-clear')?.addEventListener('click', () => {
            if (confirm('Clear all logs from display?')) {
                this.logs = [];
                this.applyFilters();
            }
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
            const response = await fetch('/api/admin/logs?limit=200');
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

        // Build HTML for all logs
        const html = this.filteredLogs
            .map(log => {
                const levelColor = this.levelColors[log.level] || 'secondary';
                const timestamp = new Date(log.timestamp).toLocaleTimeString('en-GB', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    fractionalSecondDigits: 3,
                });

                // Handle multiline messages (e.g., stack traces)
                const messageLines = log.message.split('\n');
                const firstLine = this.escapeHtml(messageLines[0]);
                const additionalLines = messageLines
                    .slice(1)
                    .map(line => `<div class="ms-4 text-muted">${this.escapeHtml(line)}</div>`)
                    .join('');

                return `
                    <div class="log-entry p-2 border-bottom border-secondary" data-level="${log.level}">
                        <span class="text-muted">${timestamp}</span>
                        <span class="badge bg-${levelColor} ms-2">${log.level}</span>
                        <span class="ms-2 text-light">${firstLine}</span>
                        ${additionalLines}
                    </div>
                `;
            })
            .join('');

        logsDisplay.innerHTML = html;

        // Auto-scroll to bottom if enabled
        if (this.autoScroll) {
            this.scrollToBottom();
        }

        this.updateLogsCount();
    }

    scrollToBottom() {
        const logsDisplay = document.getElementById('logs-display');
        if (logsDisplay) {
            logsDisplay.scrollTop = logsDisplay.scrollHeight;
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
            a.download = `logs-export-${new Date().toISOString().split('T')[0]}.${format}`;
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
