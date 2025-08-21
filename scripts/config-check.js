#!/usr/bin/env node
/**
 * Configuration and runtime safeguards check.
 * Verifies rate limiter settings, session configuration, and critical env vars.
 */
const fs = require('fs');
const path = require('path');

const errors = [];
const warnings = [];

function section(title) {
    console.log(`\n=== ${title} ===`);
}

function loadPackageJson() {
    const p = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkEnvVar(name, opts = {}) {
    const val = process.env[name];
    if (!val) {
        (opts.optional ? warnings : errors).push(`Env var ${name} is missing`);
    } else if (opts.minLength && val.length < opts.minLength) {
        warnings.push(`Env var ${name} seems too short (<${opts.minLength})`);
    }
}

function checkSessionConfig() {
    section('Session Config');
    checkEnvVar('SESSION_SECRET', { minLength: 32 });
    const sessionsDir = path.join(__dirname, '..', 'sessions');
    try {
        const stat = fs.statSync(sessionsDir);
        if (!stat.isDirectory()) errors.push('sessions exists but is not a directory');
    } catch (e) {
        errors.push('sessions directory missing');
    }
}

function checkRateLimiter() {
    section('Rate Limiter Defaults');
    // Static expectations based on server.js hard-coded values
    const expected = [
        { name: 'loginLimiter', windowMs: 15 * 60 * 1000, max: 10 },
        { name: 'twoFaLimiter', windowMs: 5 * 60 * 1000, max: 5 },
    ];
    expected.forEach(l => {
        console.log(
            `Expect ${l.name}: windowMs=${l.windowMs} (${l.windowMs / 60000}m), max=${l.max}`
        );
    });
    console.log(
        'Note: Actual values are defined in server.js; this script validates assumptions only.'
    );
}

function checkSecurityRecommendations() {
    section('Security Recommendations');
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        warnings.push('NODE_ENV not set to production');
    }
}

function summarize() {
    section('Result');
    if (errors.length === 0) console.log('Errors: none');
    else {
        console.log('Errors:');
        errors.forEach(e => console.log(' - ' + e));
    }
    if (warnings.length === 0) console.log('Warnings: none');
    else {
        console.log('Warnings:');
        warnings.forEach(w => console.log(' - ' + w));
    }
    console.log('\nExit code: ' + (errors.length > 0 ? 1 : 0));
    process.exit(errors.length > 0 ? 1 : 0);
}

function run() {
    loadPackageJson();
    checkSessionConfig();
    checkRateLimiter();
    checkSecurityRecommendations();
    summarize();
}

run();
