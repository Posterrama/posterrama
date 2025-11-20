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
                        displayFormats: {
                            hour: 'MMM d, HH:mm',
                        },
                    },
                    title: {
                        display: true,
                        text: 'Time',
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

        // Request Rate Chart
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
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
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

        // Cache Performance Chart
        const cacheCtx = document.getElementById('chart-cache');
        if (cacheCtx) {
            charts.cache = new Chart(cacheCtx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Hit Rate (%)',
                            data: [],
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                            fill: true,
                            tension: 0.4,
                            yAxisID: 'y',
                        },
                    ],
                },
                options: {
                    ...commonOptions,
                    scales: {
                        ...commonOptions.scales,
                        y: {
                            ...commonOptions.scales.y,
                            max: 100,
                            title: {
                                display: true,
                                text: 'Hit Rate (%)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
                                    .trim(),
                            },
                        },
                    },
                },
            });
        }

        // System Load Chart
        const systemCtx = document.getElementById('chart-system');
        if (systemCtx) {
            charts.system = new Chart(systemCtx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'CPU (%)',
                            data: [],
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            fill: true,
                            tension: 0.4,
                            yAxisID: 'y',
                        },
                        {
                            label: 'Memory (%)',
                            data: [],
                            borderColor: '#06b6d4',
                            backgroundColor: 'rgba(6, 182, 212, 0.1)',
                            fill: true,
                            tension: 0.4,
                            yAxisID: 'y',
                        },
                    ],
                },
                options: {
                    ...commonOptions,
                    scales: {
                        ...commonOptions.scales,
                        y: {
                            ...commonOptions.scales.y,
                            max: 100,
                            title: {
                                display: true,
                                text: 'Usage (%)',
                                color: getComputedStyle(document.documentElement)
                                    .getPropertyValue('--color-text-secondary')
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
            const response = await fetch('/api/admin/performance/metrics?period=7d', {
                credentials: 'same-origin',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to load metrics');
            }

            updateDashboard(result.data);
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
            const history = data.requests.history.slice(-168); // Last 7 days hourly
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

        // Update requests chart
        if (charts.requests && data.system?.history) {
            const history = data.system.history.slice(-168);
            // Requests data would ideally come from dedicated metrics
            // For now, use system history timestamps with dummy data
            charts.requests.data.datasets[0].data = history.map((d, _i) => ({
                x: new Date(d.timestamp),
                y: Math.random() * 50 + 10, // Placeholder
            }));
            charts.requests.update('none');
        }

        // Update cache chart
        if (charts.cache && data.cache?.current) {
            // For cache, we show current hit rate over time
            // This would ideally be tracked separately
            const currentHitRate = data.cache.current.hitRate || 0;
            const now = new Date();
            if (!charts.cache.data.datasets[0].data.length) {
                // Initialize with current value
                charts.cache.data.datasets[0].data = [{ x: now, y: currentHitRate }];
            } else {
                // Add new data point
                charts.cache.data.datasets[0].data.push({ x: now, y: currentHitRate });
                // Keep last 168 points (7 days)
                if (charts.cache.data.datasets[0].data.length > 168) {
                    charts.cache.data.datasets[0].data.shift();
                }
            }
            charts.cache.update('none');
        }

        // Update system chart
        if (charts.system && data.system?.history) {
            const history = data.system.history.slice(-168);
            charts.system.data.datasets[0].data = history.map(d => ({
                x: new Date(d.timestamp),
                y: d.cpu || 0,
            }));
            charts.system.data.datasets[1].data = history.map(d => ({
                x: new Date(d.timestamp),
                y: d.memory || 0,
            }));
            charts.system.update('none');
        }
    }

    function updateEndpointsTable(endpoints) {
        const tbody = document.getElementById('perf-endpoints-tbody');
        if (!tbody) return;

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

        tbody.innerHTML = endpoints
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
