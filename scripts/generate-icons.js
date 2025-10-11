#!/usr/bin/env node

/**
 * Generate crisp multi-size icons from SVG source
 * Uses Sharp for high-quality downscaling
 */

const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

const ICON_SIZES = [16, 32, 72, 96, 128, 144, 152, 192, 384, 512];
const SOURCE_SVG = path.join(__dirname, '../public/icons/posterrama-icon.svg');
const OUTPUT_DIR = path.join(__dirname, '../public/icons');

async function generateIcons() {
    console.log('🎨 Generating crisp multi-size icons...\n');

    // Ensure output directory exists
    await fs.ensureDir(OUTPUT_DIR);

    // Read SVG source
    const svgBuffer = await fs.readFile(SOURCE_SVG);

    // Generate each size
    for (const size of ICON_SIZES) {
        const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);

        try {
            await sharp(svgBuffer, { density: 300 }) // High DPI rendering
                .resize(size, size, {
                    kernel: sharp.kernel.lanczos3, // Best quality downscaling
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent background
                })
                .png({
                    compressionLevel: 9, // Maximum compression
                    quality: 100, // Best quality
                    palette: false, // True color
                })
                .toFile(outputPath);

            const stats = await fs.stat(outputPath);
            console.log(`✅ Generated ${size}x${size} (${(stats.size / 1024).toFixed(1)}KB)`);
        } catch (error) {
            console.error(`❌ Failed to generate ${size}x${size}:`, error.message);
        }
    }

    // Generate favicon.ico (using 32x32 as source)
    console.log('\n🎨 Generating favicon.ico...');
    const faviconPath = path.join(__dirname, '../public/favicon.ico');
    const icon32Path = path.join(OUTPUT_DIR, 'icon-32x32.png');

    try {
        // ICO format: just copy the 32x32 PNG with .ico extension
        // Modern browsers support PNG in .ico files
        await fs.copyFile(icon32Path, faviconPath);
        const stats = await fs.stat(faviconPath);
        console.log(`✅ Generated favicon.ico (${(stats.size / 1024).toFixed(1)}KB)`);
    } catch (error) {
        console.error('❌ Failed to generate favicon.ico:', error.message);
    }

    console.log('\n🎉 Icon generation complete!');
    console.log(`📁 Icons saved to: ${OUTPUT_DIR}`);
}

// Run
generateIcons().catch(error => {
    console.error('❌ Icon generation failed:', error);
    process.exit(1);
});
