/**
 * Performance Dashboard
 * Charts and real-time metrics for system monitoring
 */

(function () {
    'use strict';

    // Wait for DOM and Chart.js to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* global Chart */
    const charts = {};
    let autoRefreshInterval = null;
    const AUTO_REFRESH_MS = 30000; // 30 seconds
    const STORAGE_KEY = 'performance_metrics_history';
    const STORAGE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

    function init() {
        // Only initialize when performance section is active
        const observer = new MutationObserver(checkPerformanceSection);
        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['hidden', 'class'],
        });

        // Check immediately in case section is already visible
        checkPerformanceSection();
    }

    function checkPerformanceSection() {
        const section = document.getElementById('section-performance');
        if (section && !section.hasAttribute('hidden')) {
            if (!charts.latency) {
                initializeCharts();
                loadPerformanceData();
                startAutoRefresh();
            }
        } else {
            // Destroy charts when section is hidden to prevent canvas reuse errors
            stopAutoRefresh();
            destroyCharts();
        }
    }

    function destroyCharts() {
        Object.keys(charts).forEach(key => {
            if (charts[key]) {
                charts[key].destroy();
                delete charts[key];
            }
        });
    }

    // LocalStorage functions for 24h data persistence
    function saveMetricsToStorage(data) {
        try {
            const stored = {
                timestamp: Date.now(),
                data: data,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        } catch (e) {
            console.warn('[Performance] Failed to save to localStorage:', e);
        }
    }

    function loadMetricsFromStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;

            const parsed = JSON.parse(stored);
            const age = Date.now() - parsed.timestamp;

            // Check if data is still valid (< 24 hours old)
            if (age > STORAGE_EXPIRY) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }

            return parsed.data;
        } catch (e) {
            console.warn('[Performance] Failed to load from localStorage:', e);
            return null;
        }
    }

    function mergeHistoricalData(newData, cachedData) {
        if (!cachedData) return newData;

        // Merge request history
        if (newData.requests?.history && cachedData.requests?.history) {
            const combined = [...cachedData.requests.history, ...newData.requests.history];
            // Remove duplicates based on timestamp
            const unique = Array.from(
                new Map(combined.map(item => [item.timestamp, item])).values()
            );
            // Sort by timestamp and keep last 24 hours
            newData.requests.history = unique
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                .slice(-24);
        }

        // Similar for other metrics...
        return newData;
    }

    function initializeCharts() {
        if (typeof Chart === 'undefined') {
            console.warn('[Performance] Chart.js not loaded yet');
            return;
        }

        // Destroy existing charts before creating new ones
        destroyCharts();

        // Common chart options
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-text-primary')
                            .trim(),
                        boxWidth: 12,
                        boxHeight: 12,
                        useBorderRadius: true,
                        borderRadius: 3,
                    },
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: getComputedStyle(document.documentElement)
                        .getPropertyValue('--color-bg-card')
                        .trim(),
                    titleColor: getComputedStyle(document.documentElement)
                        .getPropertyValue('--color-text-primary')
                        .trim(),
                    bodyColor: getComputedStyle(document.documentElement)
                        .getPropertyValue('--color-text-secondary')
                        .trim(),
                    borderColor: getComputedStyle(document.documentElement)
                        .getPropertyValue('--color-border')
                        .trim(),
                    borderWidth: 1,
                },
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        stepSize: 2,
                        displayFormats: {
                            hour: 'HH:mm',
                            day: 'MMM d',
                        },
                        tooltipFormat: 'MMM d, HH:mm',
                    },
                    title: {
                        display: true,
                        text: 'Time',
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-text-secondary')
                            .trim(),
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-text-secondary')
                            .trim(),
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-border')
                            .trim(),
                        borderColor: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-border')
                            .trim(),
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Value',
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-text-secondary')
                            .trim(),
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-text-secondary')
                            .trim(),
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-border')
                            .trim(),
                        borderColor: getComputedStyle(document.documentElement)
                            .getPropertyValue('--color-border')
                            .trim(),
                    },
                },
            },
        };

        // Latency Chart
        const latencyCtx = document.getElementById('chart-latency');
        if (latencyCtx) {
            charts.latency = new Chart(latencyCtx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'P95',
                            data: [],
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            fill: true,
                            tension: 0.4,
                        },
                        {
                            label: 'Avg',
                            data: [],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            fill: true,
                            tension: 0.4,
                        },
                    ],
                },
                options: {
                    ...commonOptions,
                    scales: {
                        ...commonOptions.scales,
                        y: {
                            ...commonOptions.scales.y,
                            title: {
                                display: true,
                                text: 'Latency (ms)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                        },
                    },
                },
            });
        }

        // Request Rate Chart (Area chart for trend visualization)
        const requestsCtx = document.getElementById('chart-requests');
        if (requestsCtx) {
            charts.requests = new Chart(requestsCtx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Requests/min',
                            data: [],
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                        },
                    ],
                },
                options: {
                    ...commonOptions,
                    scales: {
                        ...commonOptions.scales,
                        y: {
                            ...commonOptions.scales.y,
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Requests/min',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                        },
                    },
                },
            });
        }

        // Cache chart removed - use KPI card instead

        // System Load - Scatter Chart (CPU vs Memory correlation)
        const systemCtx = document.getElementById('chart-system');
        if (systemCtx) {
            charts.system = new Chart(systemCtx, {
                type: 'scatter',
                data: {
                    datasets: [
                        {
                            label: 'System Load',
                            data: [],
                            backgroundColor: 'rgba(139, 92, 246, 0.6)',
                            borderColor: '#8b5cf6',
                            pointRadius: 6,
                            pointHoverRadius: 8,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false,
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `CPU: ${context.parsed.x.toFixed(1)}%, Memory: ${context.parsed.y.toFixed(1)}%`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            position: 'bottom',
                            min: 0,
                            max: 100,
                            title: {
                                display: true,
                                text: 'CPU Usage (%)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            ticks: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            grid: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-border')
                                    .trim(),
                            },
                        },
                        y: {
                            type: 'linear',
                            min: 0,
                            max: 100,
                            title: {
                                display: true,
                                text: 'Memory Usage (%)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            ticks: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            grid: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-border')
                                    .trim(),
                            },
                        },
                    },
                },
            });
        }

        // Endpoint Performance - Bubble Chart
        const endpointsCtx = document.getElementById('chart-endpoints');
        if (endpointsCtx) {
            charts.endpoints = new Chart(endpointsCtx, {
                type: 'bubble',
                data: {
                    datasets: [],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-primary')
                                    .trim(),
                                usePointStyle: true,
                                padding: 15,
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.raw.label || '';
                                    return [
                                        `Endpoint: ${label}`,
                                        `Requests: ${context.parsed.x}`,
                                        `Latency: ${context.parsed.y}ms`,
                                        `Errors: ${context.raw.errors || 0}`,
                                    ];
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            position: 'bottom',
                            title: {
                                display: true,
                                text: 'Request Count',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            ticks: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            grid: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-border')
                                    .trim(),
                            },
                        },
                        y: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Average Latency (ms)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            ticks: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                            grid: {
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-border')
                                    .trim(),
                            },
                        },
                    },
                },
            });
        }
    }

    async function loadPerformanceData() {
        try {
            const response = await fetch('/api/admin/performance/metrics?period=24h', {
                credentials: 'same-origin',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load metrics');
            }

            // Load cached data and merge with new data
            const cachedData = loadMetricsFromStorage();
            const mergedData = mergeHistoricalData(result.data, cachedData);

            // Save merged data back to storage
            saveMetricsToStorage(mergedData);

            updateDashboard(mergedData);
        } catch (error) {
            console.error('[Performance] Failed to load data:', error);
            showError('Failed to load performance metrics');
        }
    }

    function updateDashboard(data) {
        // Update KPI cards
        updateKPIs(data);

        // Update charts
        updateCharts(data);

        // Update endpoints table
        updateEndpointsTable(data.requests.topEndpoints || []);

        // Update source health
        updateSourceHealth(data.sources.current || {});
    }

    function updateKPIs(data) {
        const rpm = data.requests?.current?.requestsPerMinute || 0;
        const latency = data.requests?.current?.latency?.average || 0;
        const cacheHit = data.cache?.current?.hitRate || 0;
        const wsDevices = data.websocket?.current?.activeDevices || 0;

        setText('perf-rpm', rpm.toFixed(1));
        setText('perf-latency', `${Math.round(latency)}ms`);
        setText('perf-cache-hit', `${cacheHit.toFixed(1)}%`);
        setText('perf-ws-devices', wsDevices);
    }

    function updateCharts(data) {
        // Update latency chart
        if (charts.latency && data.requests?.history) {
            const history = data.requests.history.slice(-24); // Last 24 hours
            charts.latency.data.datasets[0].data = history.map(d => ({
                x: new Date(d.timestamp),
                y: d.p95 || 0,
            }));
            charts.latency.data.datasets[1].data = history.map(d => ({
                x: new Date(d.timestamp),
                y: d.avg || 0,
            }));
            charts.latency.update('none'); // Update without animation
        }

        // Update requests chart with actual request rate data
        if (charts.requests && data.requests?.history) {
            const history = data.requests.history.slice(-24);
            charts.requests.data.datasets[0].data = history.map(d => ({
                x: new Date(d.timestamp),
                y: d.requestsPerMinute || 0,
            }));
            charts.requests.update('none');
        }

        // Update system scatter chart (CPU vs Memory correlation)
        if (charts.system && data.system?.history) {
            const history = data.system.history.slice(-24);
            charts.system.data.datasets[0].data = history.map(d => ({
                x: d.cpu || 0,
                y: d.memory || 0,
            }));
            charts.system.update('none');
        }

        // Update endpoint bubble chart
        if (charts.endpoints && data.requests?.topEndpoints) {
            const endpoints = data.requests.topEndpoints;

            // Group by endpoint type for different colors
            const apiEndpoints = endpoints.filter(e => e.path.includes('/api/'));
            const otherEndpoints = endpoints.filter(e => !e.path.includes('/api/'));

            charts.endpoints.data.datasets = [
                {
                    label: 'API Endpoints',
                    data: apiEndpoints.map(e => ({
                        x: e.count,
                        y: e.avgLatency,
                        r: Math.max(5, Math.min(30, (e.errorRate || 0) * 3 + 8)), // Size based on error rate
                        label: e.path,
                        errors: e.errorRate || 0,
                    })),
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: '#3b82f6',
                },
                {
                    label: 'Other Endpoints',
                    data: otherEndpoints.map(e => ({
                        x: e.count,
                        y: e.avgLatency,
                        r: Math.max(5, Math.min(30, (e.errorRate || 0) * 3 + 8)),
                        label: e.path,
                        errors: e.errorRate || 0,
                    })),
                    backgroundColor: 'rgba(16, 185, 129, 0.6)',
                    borderColor: '#10b981',
                },
            ];
            charts.endpoints.update('none');
        }
    }

    // State for table sorting
    let endpointsData = [];
    const currentSort = { column: 'avgLatency', direction: 'desc' };

    function updateEndpointsTable(endpoints) {
        const tbody = document.getElementById('perf-endpoints-tbody');
        if (!tbody) return;

        // Store data for sorting
        endpointsData = endpoints || [];

        if (!endpoints || endpoints.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: var(--color-text-secondary);">
                        No endpoint data available
                    </td>
                </tr>
            `;
            return;
        }

        // Initialize sort handlers on first call
        if (!tbody.dataset.sortInitialized) {
            initializeTableSort();
            tbody.dataset.sortInitialized = 'true';
        }

        renderEndpointsTable();
    }

    function initializeTableSort() {
        const headers = document.querySelectorAll('#perf-endpoints-table th.sortable');
        headers.forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                if (currentSort.column === column) {
                    // Toggle direction
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    // New column, default to descending (highest first) except for path
                    currentSort.column = column;
                    currentSort.direction = column === 'path' ? 'asc' : 'desc';
                }
                renderEndpointsTable();
                updateSortIcons();
            });
        });
        updateSortIcons();
    }

    function updateSortIcons() {
        const headers = document.querySelectorAll('#perf-endpoints-table th.sortable');
        headers.forEach(th => {
            const icon = th.querySelector('.sort-icon');
            if (!icon) return;

            if (th.dataset.sort === currentSort.column) {
                icon.className =
                    currentSort.direction === 'asc'
                        ? 'fas fa-sort-up sort-icon'
                        : 'fas fa-sort-down sort-icon';
            } else {
                icon.className = 'fas fa-sort sort-icon';
            }
        });
    }

    function renderEndpointsTable() {
        const tbody = document.getElementById('perf-endpoints-tbody');
        if (!tbody || !endpointsData.length) return;

        // Sort data
        const sorted = [...endpointsData].sort((a, b) => {
            let aVal = a[currentSort.column];
            let bVal = b[currentSort.column];

            // Handle string comparison for path
            if (currentSort.column === 'path') {
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();
                return currentSort.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            // Numeric comparison for other columns
            aVal = Number(aVal) || 0;
            bVal = Number(bVal) || 0;
            return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        });

        tbody.innerHTML = sorted
            .map(
                ep => `
            <tr>
                <td><code>${escapeHtml(ep.path)}</code></td>
                <td>${ep.count || 0}</td>
                <td>${ep.avgLatency}ms</td>
                <td>
                    <span class="badge ${ep.errorRate > 5 ? 'badge-error' : ep.errorRate > 1 ? 'badge-warning' : 'badge-success'}">
                        ${ep.errorRate.toFixed(1)}%
                    </span>
                </td>
            </tr>
        `
            )
            .join('');
    }

    function updateSourceHealth(sources) {
        const container = document.getElementById('perf-sources');
        if (!container) return;

        const sourceNames = Object.keys(sources);
        if (sourceNames.length === 0) {
            container.innerHTML = `
                <p style="text-align: center; padding: 20px; color: var(--color-text-secondary);">
                    No sources configured
                </p>
            `;
            return;
        }

        container.innerHTML = sourceNames
            .map(name => {
                const source = sources[name];
                const status = source.healthy ? 'success' : 'error';
                const icon = source.healthy ? 'check-circle' : 'exclamation-circle';

                return `
                <div class="status-card status-${status}">
                    <div class="card-icon"><i class="fas fa-${icon}"></i></div>
                    <div class="card-content">
                        <h3>${escapeHtml(name.toUpperCase())}</h3>
                        <span class="metric">${source.avgLatency}ms</span>
                        <span class="trend">${source.errors} errors</span>
                    </div>
                </div>
            `;
            })
            .join('');
    }

    function startAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }

        autoRefreshInterval = setInterval(() => {
            const section = document.getElementById('section-performance');
            if (section && !section.hasAttribute('hidden')) {
                loadPerformanceData();
            }
        }, AUTO_REFRESH_MS);
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = text;
        }
    }

    function showError(message) {
        const kpiCards = document.getElementById('perf-kpi-cards');
        if (kpiCards) {
            kpiCards.insertAdjacentHTML(
                'afterbegin',
                `
                <div class="alert alert-error" style="grid-column: 1 / -1;">
                    <i class="fas fa-exclamation-triangle"></i>
                    ${escapeHtml(message)}
                </div>
            `
            );
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopAutoRefresh();
        Object.values(charts).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
    });
})();
