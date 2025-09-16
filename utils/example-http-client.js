/**
 * Example HTTP client for a new source adapter.
 * Replace endpoints and auth headers as needed.
 */
const fetch = require('node-fetch');

function createExampleClient(serverConfig) {
    const baseUrl = serverConfig?.url?.replace(/\/$/, '') || '';
    const apiKey = serverConfig?.apiKey || '';

    async function getJson(path, params) {
        const url = new URL(baseUrl + path);
        if (params && typeof params === 'object') {
            Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
        }
        const res = await fetch(url.toString(), {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            timeout: 15000,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
    }

    // Example pagination surface compatible with sources/example.js usage
    async function getItems({ parentId, includeItemTypes, recursive, fields, limit, startIndex }) {
        // Map the generic args to the target API's query params
        const params = {
            parentId,
            type: Array.isArray(includeItemTypes) ? includeItemTypes.join(',') : '',
            recursive: recursive ? '1' : '0',
            fields: Array.isArray(fields) ? fields.join(',') : '',
            limit: limit || 1000,
            start: startIndex || 0,
        };
        // Replace with your real endpoint path
        const data = await getJson('/api/items', params);
        // Normalize to { Items: [...] } shape used by adapters
        return { Items: Array.isArray(data?.items) ? data.items : [] };
    }

    return { getItems };
}

module.exports = { createExampleClient };
