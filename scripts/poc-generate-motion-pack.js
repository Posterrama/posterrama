#!/usr/bin/env node

/**
 * POC: Generate a ZIP-based motion movie posterpack under:
 *   <localDirectory.rootPath>/complete/manual/<Title (Year)>.zip
 *
 * ZIP entries:
 *  - poster.jpg
 *  - thumbnail.jpg
 *  - motion.mp4 (H.264)
 *  - metadata.json (explicitly flags it as a motion movie posterpack)
 *
 * Requires: npm devDependency `ffmpeg-static` (bundled FFmpeg).
 */

const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { spawn } = require('child_process');
const sharp = require('sharp');
const os = require('os');
const AdmZip = require('adm-zip');

function parseArgs(argv) {
    const args = {
        title: 'My Movie',
        year: new Date().getFullYear(),
        seconds: 8,
        width: 720,
        height: 1080,
        outZip: null,
        poster: null,
        overwrite: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        const next = argv[i + 1];
        if (a === '--title' && next) {
            args.title = next;
            i += 1;
        } else if (a === '--year' && next) {
            args.year = Number(next);
            i += 1;
        } else if (a === '--seconds' && next) {
            args.seconds = Math.max(1, Number(next));
            i += 1;
        } else if (a === '--size' && next) {
            const m = String(next)
                .toLowerCase()
                .match(/^(\d+)x(\d+)$/);
            if (m) {
                args.width = Number(m[1]);
                args.height = Number(m[2]);
            }
            i += 1;
        } else if (a === '--folder' && next) {
            // Back-compat alias: --folder is treated as output ZIP basename.
            args.outZip = next;
            i += 1;
        } else if (a === '--outZip' && next) {
            args.outZip = next;
            i += 1;
        } else if (a === '--poster' && next) {
            args.poster = next;
            i += 1;
        } else if (a === '--overwrite') {
            args.overwrite = true;
        }
    }

    if (!Number.isFinite(args.year)) args.year = new Date().getFullYear();

    return args;
}

function safeFolderName(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function run(cmd, args, { cwd } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => (stdout += d.toString()));
        child.stderr.on('data', d => (stderr += d.toString()));

        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) return resolve({ stdout, stderr });
            const err = new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${code})`);
            err.stdout = stdout;
            err.stderr = stderr;
            return reject(err);
        });
    });
}

async function writePosterImage({ filePath, title, year, width, height }) {
    const bg = sharp({
        create: {
            width,
            height,
            channels: 3,
            background: '#14141a',
        },
    });

    const safeTitle = String(title || 'Untitled').replace(/[<>&]/g, s => {
        if (s === '<') return '&lt;';
        if (s === '>') return '&gt;';
        if (s === '&') return '&amp;';
        return s;
    });

    const label = `${safeTitle}${year ? ` (${year})` : ''}`;

    // Use an SVG overlay so we don't depend on system fonts being present.
    const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a24"/>
      <stop offset="100%" stop-color="#0d0d12"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#g)"/>
  <rect x="0" y="${Math.floor(height * 0.65)}" width="${width}" height="${Math.ceil(height * 0.35)}" fill="#000" opacity="0.35"/>
  <text x="${Math.floor(width * 0.07)}" y="${Math.floor(height * 0.78)}" font-family="sans-serif" font-size="${Math.max(28, Math.floor(width * 0.055))}" fill="#ffffff" font-weight="700">${label}</text>
  <text x="${Math.floor(width * 0.07)}" y="${Math.floor(height * 0.84)}" font-family="sans-serif" font-size="${Math.max(18, Math.floor(width * 0.035))}" fill="#c9c9d6" font-weight="400">Motion Poster POC</text>
</svg>`;

    const composed = bg.composite([
        {
            input: Buffer.from(svg),
            top: 0,
            left: 0,
        },
    ]);

    await composed.jpeg({ quality: 88, mozjpeg: true }).toFile(filePath);
}

async function writePosterFromFile({ inputPath, outputPath, width, height }) {
    const buf = await fs.readFile(inputPath);
    await sharp(buf)
        .resize(width, height, { fit: 'cover' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toFile(outputPath);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
        throw new Error('ffmpeg-static binary not found. Try: npm i -D ffmpeg-static');
    }

    // Determine Local Directory root from config.json when available.
    let localRoot = path.join(process.cwd(), 'media');
    try {
        const cfg = require('../config.json');
        localRoot = cfg?.localDirectory?.rootPath || localRoot;
    } catch (_) {
        // ignore
    }

    const baseName = safeFolderName(args.outZip || `${args.title} (${args.year})`).replace(
        /\.zip$/i,
        ''
    );
    const outDir = path.resolve(localRoot, 'motion');
    const outZipPath = path.join(outDir, `${baseName}.zip`);
    await fs.mkdir(outDir, { recursive: true });

    if (!args.overwrite && existsSync(outZipPath)) {
        throw new Error(`ZIP already exists: ${outZipPath}. Use --overwrite to replace.`);
    }

    // Work in a temp dir then zip.
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-motionzip-'));
    const posterPath = path.join(workDir, 'poster.jpg');
    const thumbPath = path.join(workDir, 'thumbnail.jpg');
    const motionPath = path.join(workDir, 'motion.mp4');
    const metaPath = path.join(workDir, 'metadata.json');

    if (args.poster) {
        await writePosterFromFile({
            inputPath: path.resolve(args.poster),
            outputPath: posterPath,
            width: args.width,
            height: args.height,
        });
    } else {
        await writePosterImage({
            filePath: posterPath,
            title: args.title,
            year: args.year,
            width: args.width,
            height: args.height,
        });
    }

    // Thumbnail currently equals poster; keep both names so local scanning picks it up.
    await fs.copyFile(posterPath, thumbPath);

    const metadata = {
        // Explicitly mark as motion movie posterpack
        packType: 'motion',
        mediaType: 'movie',
        isMotionPoster: true,
        title: args.title,
        year: args.year,
        sourceId: `local-motion-poc-${Date.now()}`,
        overview: 'Generated by Posterrama motion poster POC generator.',
        genres: ['POC'],
        createdAt: new Date().toISOString(),
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

    // Create a subtle motion MP4 from the poster image using zoompan.
    // NOTE: This is intentionally simple and CPU-friendly.
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(args.seconds * fps));

    await run(ffmpegPath, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-loop',
        '1',
        '-i',
        posterPath,
        '-t',
        String(args.seconds),
        '-vf',
        [
            `scale=${args.width}:${args.height}:force_original_aspect_ratio=increase`,
            `crop=${args.width}:${args.height}`,
            `zoompan=z='min(zoom+0.0007,1.06)':d=1:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=${args.width}x${args.height}:fps=${fps}`,
            'format=yuv420p',
        ].join(','),
        '-frames:v',
        String(totalFrames),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        motionPath,
    ]);

    const zip = new AdmZip();
    zip.addFile('poster.jpg', await fs.readFile(posterPath));
    zip.addFile('thumbnail.jpg', await fs.readFile(thumbPath));
    zip.addFile('motion.mp4', await fs.readFile(motionPath));
    zip.addFile('metadata.json', await fs.readFile(metaPath));
    zip.writeZip(outZipPath);

    // Cleanup temp directory
    try {
        await fs.rm(workDir, { recursive: true, force: true });
    } catch (_) {
        // ignore
    }

    console.log(`Created motion ZIP posterpack: ${outZipPath}`);
    if (args.poster) console.log(`  based on poster: ${args.poster}`);
}

main().catch(err => {
    console.error(err?.stderr || err?.message || err);
    process.exit(1);
});
