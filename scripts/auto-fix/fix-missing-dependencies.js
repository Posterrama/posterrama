#!/usr/bin/env node

// Auto-fix missing dependencies in package.json
const { execSync } = require('child_process');

// Color codes
const colors = {
    red: '\x1b[0;31m',
    green: '\x1b[0;32m',
    yellow: '\x1b[1;33m',
    blue: '\x1b[0;34m',
    nc: '\x1b[0m',
};

function log(level, message) {
    const color = colors[level] || colors.nc;
    console.log(`${color}${message}${colors.nc}`);
}

let fixed = 0;
let errors = 0;

async function findAndFixMissingDependencies() {
    log('blue', '🔧 Auto-fixing missing dependencies...\n');

    try {
        // Get npm ls output in JSON format to detect missing deps
        const result = execSync('npm ls --json --depth=0', { encoding: 'utf8', stdio: 'pipe' });
        const data = JSON.parse(result);
        const problems = data.problems || [];

        const missingDeps = [];
        problems.forEach(problem => {
            if (problem.includes('missing')) {
                const match = problem.match(/missing: (.+?),/);
                if (match) {
                    const depName = match[1].split('@')[0]; // Remove version info
                    missingDeps.push(depName);
                }
            }
        });

        if (missingDeps.length === 0) {
            log('green', '✅ No missing dependencies found');
            return;
        }

        log('yellow', `⚠️  Found ${missingDeps.length} missing dependencies:`);
        missingDeps.forEach(dep => log('yellow', `   - ${dep}`));

        // Auto-install missing dependencies
        log('blue', '\n🔧 Installing missing dependencies...');

        for (const dep of missingDeps) {
            try {
                log('blue', `Installing and adding ${dep} to package.json...`);

                // Determine if it should be a devDependency or dependency
                const isDevDep =
                    dep.includes('test') ||
                    dep.includes('jest') ||
                    dep.includes('eslint') ||
                    dep.includes('babel') ||
                    dep.includes('prettier') ||
                    dep.includes('@types');

                const installCmd = isDevDep
                    ? `npm install --save-dev ${dep}`
                    : `npm install --save ${dep}`;

                execSync(installCmd, { stdio: 'pipe' });
                log('green', `✅ Installed and added ${dep} to package.json`);
                fixed++;
            } catch (e) {
                log('red', `❌ Failed to install ${dep}: ${e.message}`);
                errors++;
            }
        }
    } catch (e) {
        // npm ls returns non-zero exit code when there are problems, but still outputs JSON
        try {
            const data = JSON.parse(e.stdout || '{}');
            const problems = data.problems || [];

            if (problems.length === 0) {
                log('green', '✅ No missing dependencies found');
                return;
            }

            // Same logic as above for missing deps
            const missingDeps = [];
            problems.forEach(problem => {
                if (problem.includes('missing')) {
                    const match = problem.match(/missing: (.+?),/);
                    if (match) {
                        const depName = match[1].split('@')[0];
                        missingDeps.push(depName);
                    }
                }
            });

            if (missingDeps.length > 0) {
                log('yellow', `⚠️  Found ${missingDeps.length} missing dependencies:`);
                missingDeps.forEach(dep => log('yellow', `   - ${dep}`));

                log('blue', '\n🔧 Installing missing dependencies...');

                for (const dep of missingDeps) {
                    try {
                        log('blue', `Installing ${dep}...`);
                        execSync(`npm install ${dep}`, { stdio: 'pipe' });
                        log('green', `✅ Installed ${dep}`);
                        fixed++;
                    } catch (installError) {
                        log('red', `❌ Failed to install ${dep}: ${installError.message}`);
                        errors++;
                    }
                }
            }
        } catch (parseError) {
            log('red', `❌ Error checking dependencies: ${parseError.message}`);
            errors++;
        }
    }
}

// Summary and exit
async function main() {
    await findAndFixMissingDependencies();

    console.log('\n📊 Auto-fix Summary:');
    if (fixed > 0) {
        log('green', `✅ ${fixed} dependencies installed`);
    }
    if (errors > 0) {
        log('red', `❌ ${errors} errors occurred`);
    }

    if (errors === 0) {
        log('green', '✅ All missing dependencies have been resolved');
        process.exit(0);
    } else {
        log(
            'yellow',
            '⚠️  Some dependencies could not be auto-installed - manual intervention needed'
        );
        process.exit(1);
    }
}

main().catch(e => {
    log('red', `❌ Unexpected error: ${e.message}`);
    process.exit(1);
});
