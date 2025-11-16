/**
 * Client Debug Viewer - Standalone component for live troubleshooting
 * Can be injected into any mode (screensaver, wallart, cinema)
 *
 * Usage: Add <script src="/debug-viewer.js"></script> to HTML
 * Or inject via config flag: clientDebugViewer.enabled = true
 */

(function initDebugViewer() {
    'use strict';

    // Prevent double initialization
    if (window.__debugViewerInitialized) return;
    window.__debugViewerInitialized = true;

    const MAX_LOGS = 150;
    const STORAGE_KEY = 'posterrama_debug_logs';

    // Initialize debug log storage
    window.__debugLogs = window.__debugLogs || [];

    // Override or enhance window.debugLog
    const originalDebugLog = window.debugLog;
    window.debugLog = function (message, data) {
        try {
            const timestamp = new Date().toISOString();
            const timeShort = timestamp.substring(11, 23); // HH:MM:SS.mmm
            const entry = {
                time: timestamp,
                timeShort: timeShort,
                message: message,
                data: data,
                url: window.location.href,
            };

            // Always add to in-memory array
            window.__debugLogs.push(entry);
            if (window.__debugLogs.length > MAX_LOGS) {
                window.__debugLogs.shift();
            }

            // Try localStorage but don't fail if unavailable
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                let logs = stored ? JSON.parse(stored) : [];
                logs.push(entry);
                if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
            } catch (_) {
                // localStorage unavailable - rely on in-memory
            }

            // Update on-screen debug viewer if it exists
            if (window.__updateDebugViewer) {
                window.__updateDebugViewer();
            }

            // Also log to console
            console.log('[DEBUG]', timeShort, message, data || '');

            // Call original debugLog if it existed
            if (originalDebugLog && originalDebugLog !== window.debugLog) {
                originalDebugLog(message, data);
            }
        } catch (e) {
            console.error('[DEBUG] Logger failed:', e.message);
        }
    };

    // Log initialization
    window.debugLog('DEBUG_VIEWER_COMPONENT_LOADED', {
        timestamp: Date.now(),
        mode: window.location.pathname,
        userAgent: navigator.userAgent.substring(0, 50),
    });

    // Create debug viewer UI
    function createDebugViewerUI() {
        // Check if already exists
        if (document.getElementById('debug-viewer')) return;

        const viewerHTML = `
        <div id="debug-viewer" style="display: none;">
            <div id="debug-header" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: rgba(0, 0, 0, 0.85);
                color: #0f0;
                padding: 10px;
                border-bottom: 2px solid rgba(0, 255, 0, 0.5);
                z-index: 2147483647;
                font-family: monospace;
                font-size: 11px;
                backdrop-filter: blur(5px);
            ">
                <div style="margin-bottom: 8px;">
                    <strong style="font-size: 12px; color: #0f0;">📊 DEBUG [${window.location.pathname}]</strong>
                    <span id="debug-count" style="float: right; color: #0f0; font-size: 10px;">0 logs</span>
                    <div style="clear: both;"></div>
                </div>
                
                <div style="display: table; width: 100%; table-layout: fixed;">
                    <div style="display: table-row;">
                        <div id="debug-copy-btn" style="
                            display: table-cell;
                            padding: 8px;
                            background: rgba(0, 255, 0, 0.3);
                            color: #0f0;
                            border: 2px solid #0f0;
                            border-radius: 4px;
                            font-weight: bold;
                            font-size: 12px;
                            text-align: center;
                            cursor: pointer;
                            width: 48%;
                        ">📋 COPY ALL</div>
                        <div style="display: table-cell; width: 4%;"></div>
                        <div id="debug-close-btn" style="
                            display: table-cell;
                            padding: 8px;
                            background: rgba(255, 0, 0, 0.3);
                            color: #f00;
                            border: 2px solid #f00;
                            border-radius: 4px;
                            font-weight: bold;
                            font-size: 12px;
                            text-align: center;
                            cursor: pointer;
                            width: 48%;
                        ">✖ CLOSE</div>
                    </div>
                </div>
            </div>
            
            <div id="debug-content" style="
                position: fixed;
                top: 85px;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                overflow-y: auto;
                overflow-x: hidden;
                padding: 10px;
                z-index: 2147483646;
                backdrop-filter: blur(3px);
                -webkit-overflow-scrolling: touch;
            ">
                <div id="debug-entries" style="
                    color: #0f0;
                    font-family: monospace;
                    font-size: 10px;
                    white-space: pre-wrap;
                    word-break: break-all;
                "></div>
            </div>
        </div>`;

        const container = document.createElement('div');
        container.innerHTML = viewerHTML;
        document.body.appendChild(container.firstElementChild);

        setupDebugViewerControls();
    }

    function setupDebugViewerControls() {
        const viewer = document.getElementById('debug-viewer');
        const entries = document.getElementById('debug-entries');
        const count = document.getElementById('debug-count');
        const copyBtn = document.getElementById('debug-copy-btn');
        const closeBtn = document.getElementById('debug-close-btn');

        if (!viewer) return;

        window.debugLog('DEBUG_VIEWER_UI_READY', {
            logsCount: window.__debugLogs.length,
        });

        function closeViewer() {
            viewer.style.display = 'none';
        }

        function copyAllLogs() {
            if (!window.__debugLogs || window.__debugLogs.length === 0) {
                alert('No logs to copy');
                return;
            }

            const text = window.__debugLogs
                .map(log => {
                    const dataStr = log.data ? '\n  ' + JSON.stringify(log.data, null, 2) : '';
                    return `${log.time} ${log.message}${dataStr}`;
                })
                .join('\n\n');

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard
                        .writeText(text)
                        .then(() => {
                            copyBtn.textContent = '✅ COPIED!';
                            copyBtn.style.background = 'rgba(0, 255, 0, 0.8)';
                            setTimeout(() => {
                                copyBtn.textContent = '📋 COPY ALL';
                                copyBtn.style.background = 'rgba(0, 255, 0, 0.3)';
                            }, 2000);
                        })
                        .catch(() => fallbackCopy(text));
                } else {
                    fallbackCopy(text);
                }
            } catch (e) {
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                copyBtn.textContent = '✅ COPIED!';
                copyBtn.style.background = 'rgba(0, 255, 0, 0.8)';
                setTimeout(() => {
                    copyBtn.textContent = '📋 COPY ALL';
                    copyBtn.style.background = 'rgba(0, 255, 0, 0.3)';
                }, 2000);
            } catch (e) {
                alert('Copy failed. Please try again.');
            }
            document.body.removeChild(textarea);
        }

        function updateDebugViewer() {
            if (!window.__debugLogs || window.__debugLogs.length === 0) {
                entries.textContent = 'No logs yet...\nWaiting for debug events...';
                count.textContent = '0 logs';
                return;
            }

            const logs = window.__debugLogs.slice(-100);
            const total = window.__debugLogs.length;
            count.textContent = total + ' logs total (showing last 100)';

            entries.innerHTML = logs
                .map(log => {
                    const dataStr = log.data
                        ? '\n  ' + JSON.stringify(log.data, null, 2).replace(/\n/g, '\n  ')
                        : '';
                    const isError = log.message.includes('ERROR') || log.message.includes('FAIL');
                    const color = isError ? '#f00' : '#0f0';
                    return `<div style="margin-bottom: 8px; border-left: 2px solid ${color}; padding-left: 8px;">
<span style="color: #888;">${log.timeShort}</span> <span style="color: ${color}; font-weight: bold;">${log.message}</span>${dataStr}
</div>`;
                })
                .join('');

            entries.scrollTop = entries.scrollHeight;
        }

        copyBtn.onclick = e => {
            e.stopPropagation();
            copyAllLogs();
        };

        closeBtn.onclick = e => {
            e.stopPropagation();
            closeViewer();
        };

        window.__updateDebugViewer = updateDebugViewer;

        // Auto-open debug viewer after 2 seconds (regardless of log count)
        setTimeout(() => {
            viewer.style.display = 'block';
            updateDebugViewer();
            window.debugLog('DEBUG_VIEWER_AUTO_OPENED', {
                logCount: window.__debugLogs ? window.__debugLogs.length : 0,
            });
        }, 2000);
    }

    // Initialize UI when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createDebugViewerUI);
    } else {
        createDebugViewerUI();
    }

    // Expose API for manual control
    window.PosterramaDebugViewer = {
        show: function () {
            const viewer = document.getElementById('debug-viewer');
            if (viewer) {
                viewer.style.display = 'block';
                if (window.__updateDebugViewer) window.__updateDebugViewer();
            }
        },
        hide: function () {
            const viewer = document.getElementById('debug-viewer');
            if (viewer) viewer.style.display = 'none';
        },
        clear: function () {
            window.__debugLogs = [];
            localStorage.removeItem(STORAGE_KEY);
            if (window.__updateDebugViewer) window.__updateDebugViewer();
        },
        getLogs: function () {
            return window.__debugLogs || [];
        },
    };

    console.log(
        '[PosterramaDebugViewer] Initialized. Use PosterramaDebugViewer.show() to open viewer.'
    );
})();
