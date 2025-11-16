#!/usr/bin/env node
/**
 * Reset admin password utility
 * Usage: node scripts/reset-admin-password.js [new-password]
 * If no password is provided, generates a secure random password
 */

const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ENV_FILE = path.join(__dirname, '..', '.env');
const SALT_ROUNDS = 10;

async function generateSecurePassword() {
    // Generate a secure random password: 16 chars, alphanumeric + special chars
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 16; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        password += chars[randomIndex];
    }
    return password;
}

async function resetPassword() {
    try {
        // Get new password from command line or generate one
        const newPassword = process.argv[2] || (await generateSecurePassword());
        const isGenerated = !process.argv[2];

        console.log('\n🔐 Resetting admin password...\n');

        // Hash the password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Read current .env file
        let envContent = '';
        try {
            envContent = await fs.readFile(ENV_FILE, 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            console.log('⚠️  .env file not found, creating new one');
        }

        // Replace or add ADMIN_PASSWORD_HASH (correct env var used by auth.js)
        const lines = envContent.split('\n');
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('ADMIN_PASSWORD_HASH=')) {
                lines[i] = `ADMIN_PASSWORD_HASH=${hashedPassword}`;
                found = true;
                break;
            }
        }

        if (!found) {
            // Add to end of file
            lines.push(`ADMIN_PASSWORD_HASH=${hashedPassword}`);
        }

        // Write back to .env
        await fs.writeFile(ENV_FILE, lines.join('\n'), 'utf8');

        console.log('✅ Password reset successful!\n');
        if (isGenerated) {
            console.log('🔑 Your new randomly generated password is:');
            console.log(`\n   ${newPassword}\n`);
            console.log('⚠️  Please save this password securely!\n');
        } else {
            console.log('🔑 Password has been set to your custom value\n');
        }

        console.log('🔄 Restart the server for changes to take effect:');
        console.log('   pm2 restart posterrama --update-env\n');
    } catch (error) {
        console.error('❌ Error resetting password:', error.message);
        process.exit(1);
    }
}

// Run
resetPassword();
