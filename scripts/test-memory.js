/**
 * Automated Memory Profiling Script
 * Usage: node scripts/test-memory.js
 */

const puppeteer = require('puppeteer');

const URLS = [
    { name: 'Admin', url: 'http://localhost:4000/admin' },
    { name: 'Screensaver', url: 'http://localhost:4000/screensaver' },
    { name: 'Wallart', url: 'http://localhost:4000/wallart' },
    { name: 'Cinema', url: 'http://localhost:4000/cinema' },
];

async function profileMemory(url, name) {
    console.log(`\n📊 Profiling: ${name}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Navigate and wait for load
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for poster element (display modes) or admin content
    try {
        await page.waitForSelector('#poster, #app-container', { timeout: 10000 });
    } catch (e) {
        console.log('⚠️  Timeout waiting for content, continuing...');
    }

    // Get performance metrics
    const metrics = await page.metrics();

    // Get detailed memory info via CDP
    const client = await page.target().createCDPSession();
    const { jsEventListeners, nodes } = await client.send('DOM.getDocument');

    console.log(`  ✓ Heap Size: ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  ✓ DOM Nodes: ${metrics.Nodes || nodes || 'N/A'}`);
    console.log(`  ✓ Event Listeners: ${metrics.JSEventListeners || jsEventListeners || 'N/A'}`);
    console.log(`  ✓ Layout Count: ${metrics.LayoutCount}`);
    console.log(`  ✓ Script Duration: ${(metrics.ScriptDuration * 1000).toFixed(0)} ms`);

    await browser.close();

    return {
        name,
        heapMB: (metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2),
        nodes: metrics.Nodes || 'N/A',
        listeners: metrics.JSEventListeners || 'N/A',
        layoutCount: metrics.LayoutCount,
        scriptDuration: (metrics.ScriptDuration * 1000).toFixed(0),
    };
}

async function main() {
    console.log('🔍 Posterrama Memory Profiling');
    console.log('================================\n');

    const results = [];

    for (const { name, url } of URLS) {
        try {
            const result = await profileMemory(url, name);
            results.push(result);
        } catch (error) {
            console.error(`❌ Error profiling ${name}:`, error.message);
        }
    }

    // Summary table
    console.log('\n📋 Summary');
    console.log('================================');
    console.log('Page          | Heap Size | DOM Nodes | Listeners | Layouts | Script Time');
    console.log('------------- | --------- | --------- | --------- | ------- | -----------');

    results.forEach(r => {
        const name = r.name.padEnd(13);
        const heap = `${r.heapMB} MB`.padEnd(9);
        const nodes = String(r.nodes).padEnd(9);
        const listeners = String(r.listeners).padEnd(9);
        const layouts = String(r.layoutCount).padEnd(7);
        const script = `${r.scriptDuration} ms`;

        console.log(`${name} | ${heap} | ${nodes} | ${listeners} | ${layouts} | ${script}`);
    });

    console.log('\n✅ Memory profiling complete!');
    console.log('📄 Update docs/PERFORMANCE-BASELINE.md with these actual values');
}

main().catch(console.error);
