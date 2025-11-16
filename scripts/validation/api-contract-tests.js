#!/usr/bin/env node
/**
 * API Contract Testing - Verify all API endpoints return expected structures
 * Run against live server to validate contracts
 */

const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:4000';
const TIMEOUT = 10000;

// Define expected API contracts
const API_CONTRACTS = {
    '/api/health': {
        method: 'GET',
        expectedStatus: 200,
        expectedFields: ['status', 'uptime', 'timestamp'],
        description: 'Health check endpoint',
    },
    '/get-config': {
        method: 'GET',
        expectedStatus: 200,
        expectedFields: ['config', 'transitionIntervalSeconds'],
        description: 'Display configuration',
    },
    '/api/posters': {
        method: 'GET',
        expectedStatus: 200,
        expectedFields: ['posters'],
        expectedTypes: { posters: 'array' },
        description: 'Poster collection',
    },
    '/api/admin/config': {
        method: 'GET',
        expectedStatus: 200,
        expectedFields: ['config', 'mediaServers'],
        requiresAuth: true,
        description: 'Admin configuration',
    },
};

class ContractTester {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            skipped: 0,
            details: [],
        };
    }

    async testEndpoint(path, contract) {
        const startTime = Date.now();
        console.log(`\n🧪 Testing: ${contract.description}`);
        console.log(`   Endpoint: ${contract.method} ${path}`);

        try {
            const response = await this.makeRequest(path, contract.method);
            const duration = Date.now() - startTime;

            // Check status code
            if (response.statusCode !== contract.expectedStatus) {
                this.recordFailure(
                    path,
                    `Expected status ${contract.expectedStatus}, got ${response.statusCode}`,
                    duration
                );
                return;
            }

            // Parse response body
            let body;
            try {
                body = JSON.parse(response.body);
            } catch (err) {
                this.recordFailure(path, 'Response is not valid JSON', duration);
                return;
            }

            // Check required fields
            if (contract.expectedFields) {
                const missingFields = contract.expectedFields.filter(field => !(field in body));

                if (missingFields.length > 0) {
                    this.recordFailure(
                        path,
                        `Missing required fields: ${missingFields.join(', ')}`,
                        duration
                    );
                    return;
                }
            }

            // Check field types
            if (contract.expectedTypes) {
                for (const [field, expectedType] of Object.entries(contract.expectedTypes)) {
                    const actualType = Array.isArray(body[field]) ? 'array' : typeof body[field];

                    if (actualType !== expectedType) {
                        this.recordFailure(
                            path,
                            `Field '${field}' should be ${expectedType}, got ${actualType}`,
                            duration
                        );
                        return;
                    }
                }
            }

            this.recordSuccess(path, duration);
        } catch (err) {
            if (contract.requiresAuth && err.message.includes('401')) {
                this.recordSkipped(path, 'Authentication required (expected in test env)');
            } else {
                this.recordFailure(path, err.message, Date.now() - startTime);
            }
        }
    }

    makeRequest(path, method) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, BASE_URL);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: method,
                timeout: TIMEOUT,
            };

            const req = http.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body,
                    });
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', err => reject(err));
            req.end();
        });
    }

    recordSuccess(path, duration) {
        this.results.passed++;
        this.results.details.push({ path, status: 'PASS', duration });
        console.log(`   ✅ PASS (${duration}ms)`);
    }

    recordFailure(path, reason, duration) {
        this.results.failed++;
        this.results.details.push({ path, status: 'FAIL', reason, duration });
        console.log(`   ❌ FAIL: ${reason} (${duration}ms)`);
    }

    recordSkipped(path, reason) {
        this.results.skipped++;
        this.results.details.push({ path, status: 'SKIP', reason });
        console.log(`   ⏭️  SKIP: ${reason}`);
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 API Contract Test Summary');
        console.log('='.repeat(60));
        console.log(`✅ Passed:  ${this.results.passed}`);
        console.log(`❌ Failed:  ${this.results.failed}`);
        console.log(`⏭️  Skipped: ${this.results.skipped}`);
        console.log(
            `📈 Success Rate: ${Math.round((this.results.passed / (this.results.passed + this.results.failed)) * 100)}%`
        );
        console.log('='.repeat(60));

        if (this.results.failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.results.details
                .filter(d => d.status === 'FAIL')
                .forEach(d => {
                    console.log(`   ${d.path}: ${d.reason}`);
                });
            process.exit(1);
        }
    }
}

async function main() {
    console.log('🚀 API Contract Testing Suite');
    console.log(`📡 Target: ${BASE_URL}`);
    console.log(`⏱️  Timeout: ${TIMEOUT}ms\n`);

    const tester = new ContractTester();

    for (const [path, contract] of Object.entries(API_CONTRACTS)) {
        await tester.testEndpoint(path, contract);
    }

    tester.printSummary();
}

main().catch(err => {
    console.error('\n💥 Contract testing failed:', err.message);
    process.exit(1);
});
