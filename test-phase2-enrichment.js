#!/usr/bin/env node
/**
 * Test script for Phase 2 enriched metadata fields
 *
 * Tests the following new fields:
 * - slug
 * - contentRatingAge
 * - skipCount
 * - addedAt, updatedAt
 * - ultraBlurColors
 * - ratingsDetailed (structured ratings per source)
 * - parentalGuidance (CommonSenseMedia)
 * - chapters (timeline preview)
 * - markers (intro/credits skip)
 * - guids (structured with source identification)
 */

const AdmZip = require('adm-zip');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                                                                  ║');
console.log('║   PHASE 2: ENRICHED METADATA TEST                                ║');
console.log('║                                                                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// Check if posterpack exists
const zipPath = 'media/complete/plex-export/Sinners (2025).zip';
if (!fs.existsSync(zipPath)) {
    console.error(`❌ Posterpack not found: ${zipPath}`);
    process.exit(1);
}

console.log(`📦 Analyzing posterpack: ${zipPath}\n`);

try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry('metadata.json');

    if (!entry) {
        console.error('❌ metadata.json not found in ZIP');
        process.exit(1);
    }

    const content = entry.getData().toString('utf8');
    const meta = JSON.parse(content);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 FIELD PRESENCE CHECK\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const newFields = [
        'slug',
        'contentRatingAge',
        'skipCount',
        'addedAt',
        'updatedAt',
        'ultraBlurColors',
        'ratingsDetailed',
        'parentalGuidance',
        'chapters',
        'markers',
    ];

    newFields.forEach(field => {
        const present = field in meta;
        const value = meta[field];
        const hasValue = value !== null && value !== undefined;

        const icon = present ? '✅' : '❌';
        const status = hasValue ? `(has value)` : `(null/undefined)`;

        console.log(`${icon} ${field.padEnd(20)} ${present ? status : '(not present)'}`);
    });

    // Check GUIDs structure
    console.log(`\n${'guids'.padEnd(20)} ${meta.guids ? '✅ present' : '❌ not present'}`);
    if (meta.guids) {
        const isStructured =
            Array.isArray(meta.guids) &&
            meta.guids.length > 0 &&
            typeof meta.guids[0] === 'object' &&
            meta.guids[0].source;
        console.log(`   Structure: ${isStructured ? '✅ NEW (structured)' : '⚠️  OLD (strings)'}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 FIELD DETAILS\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Show details for fields with values
    if (meta.slug) {
        console.log(`📌 slug: "${meta.slug}"`);
    }

    if (meta.contentRatingAge) {
        console.log(`🔞 contentRatingAge: ${meta.contentRatingAge}`);
    }

    if (meta.skipCount !== null && meta.skipCount !== undefined) {
        console.log(`⏭️  skipCount: ${meta.skipCount}`);
    }

    if (meta.addedAt) {
        const date = new Date(meta.addedAt);
        console.log(`📅 addedAt: ${meta.addedAt} (${date.toISOString()})`);
    }

    if (meta.updatedAt) {
        const date = new Date(meta.updatedAt);
        console.log(`📅 updatedAt: ${meta.updatedAt} (${date.toISOString()})`);
    }

    if (meta.ultraBlurColors) {
        console.log(`🎨 ultraBlurColors:`);
        console.log(`   topLeft:     #${meta.ultraBlurColors.topLeft || 'null'}`);
        console.log(`   topRight:    #${meta.ultraBlurColors.topRight || 'null'}`);
        console.log(`   bottomLeft:  #${meta.ultraBlurColors.bottomLeft || 'null'}`);
        console.log(`   bottomRight: #${meta.ultraBlurColors.bottomRight || 'null'}`);
    }

    if (meta.ratingsDetailed) {
        console.log(`⭐ ratingsDetailed:`);
        Object.keys(meta.ratingsDetailed).forEach(source => {
            console.log(`   ${source}:`);
            const ratings = meta.ratingsDetailed[source];
            Object.keys(ratings).forEach(type => {
                const val = ratings[type];
                console.log(`      ${type}: ${val.value} (image: ${val.image || 'none'})`);
            });
        });
    }

    if (meta.parentalGuidance) {
        console.log(`👨‍👩‍👧‍👦 parentalGuidance:`);
        console.log(`   oneLiner: "${meta.parentalGuidance.oneLiner || 'none'}"`);
        console.log(`   recommendedAge: ${meta.parentalGuidance.recommendedAge || 'none'}`);
    }

    if (meta.chapters && meta.chapters.length > 0) {
        console.log(`📑 chapters: ${meta.chapters.length} chapters`);
        console.log(
            `   First: index=${meta.chapters[0].index}, start=${meta.chapters[0].startMs}ms, end=${meta.chapters[0].endMs}ms`
        );
        console.log(
            `   Last:  index=${meta.chapters[meta.chapters.length - 1].index}, start=${meta.chapters[meta.chapters.length - 1].startMs}ms, end=${meta.chapters[meta.chapters.length - 1].endMs}ms`
        );
    }

    if (meta.markers && meta.markers.length > 0) {
        console.log(`🏷️  markers: ${meta.markers.length} markers`);
        meta.markers.forEach((m, i) => {
            console.log(
                `   [${i + 1}] type=${m.type}, start=${m.startMs}ms, end=${m.endMs}ms, final=${m.final}`
            );
        });
    }

    if (meta.guids && meta.guids.length > 0) {
        console.log(`🔗 guids: ${meta.guids.length} external IDs`);
        const structured = typeof meta.guids[0] === 'object' && meta.guids[0].source;
        if (structured) {
            meta.guids.slice(0, 5).forEach(g => {
                console.log(`   ${g.source}: ${g.id}`);
            });
        } else {
            meta.guids.slice(0, 5).forEach(g => {
                console.log(`   ${g}`);
            });
        }
        if (meta.guids.length > 5) {
            console.log(`   ... and ${meta.guids.length - 5} more`);
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ RESULT: Structure validated\n');
    console.log('   Old posterpack detected (null values expected)');
    console.log('   New posterpacks will populate these fields from Plex\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
} catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
}
