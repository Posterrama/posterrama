# Motion Poster Demo - Quick Start

Standalone script to test depth-based motion posters **without** touching Posterrama code.

---

## 🚀 Setup (one-time)

### 1. Install Python dependencies

```bash
cd /var/www/posterrama/docs/POC/motion-posters

# Optional but recommended
python3 -m venv .venv
source .venv/bin/activate

# CPU only (works everywhere)
pip install -r motion-demo-requirements.txt

# Or with GPU support (if you have NVIDIA GPU)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip install -r motion-demo-requirements.txt
```

### 2. Install FFmpeg (recommended)

The script can encode a browser-friendly H.264 MP4 when `ffmpeg` is available.

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

**First time:** the depth model is automatically downloaded (size depends on the model).

---

## 📝 Usage

### Basic usage

```bash
# Local poster
python motion-demo.py --input /path/to/poster.jpg

# Poster from URL (e.g. TMDB)
python motion-demo.py --input "https://image.tmdb.org/t/p/original/xyz.jpg"
```

**Output (default):** written under `media/motion/<timestamp>-<name>/`:

```
media/motion/<timestamp>-<name>/
├── motion_poster.mp4
└── depth_map.png
```

Tip for CPU speed: start with a smaller model and a smaller output width.

```bash
python motion-demo.py --input poster.jpg --model midas_small --max-width 1024
```

To override output directory:

```bash
python motion-demo.py --input poster.jpg --output motion-output
```

---

### Different effects

```bash
# Parallax (default) - foreground moves more than background
python motion-demo.py --input poster.jpg --effect parallax

# Zoom - Ken Burns style zoom in/out
python motion-demo.py --input poster.jpg --effect zoom

# Sway - gentle horizontal motion
python motion-demo.py --input poster.jpg --effect sway
```

---

### Adjust intensity

```bash
# Subtle motion (50%)
python motion-demo.py --input poster.jpg --intensity 0.5

# Normal motion (default)
python motion-demo.py --input poster.jpg --intensity 1.0

# Extra motion (150%)
python motion-demo.py --input poster.jpg --intensity 1.5
```

---

### Longer video

```bash
# 6 seconds @ 30fps (smoother)
python motion-demo.py --input poster.jpg --duration 6 --fps 30

# 3 seconds @ 24fps (smaller file)
python motion-demo.py --input poster.jpg --duration 3 --fps 24
```

---

### Use GPU (faster)

```bash
python motion-demo.py --input poster.jpg --gpu
```

**Expected times:**

- CPU: 20-40 seconds
- GPU: 5-10 seconds

---

## 🎬 Quick test with multiple posters

Create a test script:

```bash
#!/bin/bash
# test-multiple.sh

POSTERS=(
  "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg"  # Inception
  "https://image.tmdb.org/t/p/original/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg"  # Interstellar
  "https://image.tmdb.org/t/p/original/p6AbOJvMQhBmffd0PIv0u8ghWeY.jpg"  # Blade Runner
)

for i in "${!POSTERS[@]}"; do
  echo "Processing poster $((i+1))/${#POSTERS[@]}..."
  python motion-demo.py \
    --input "${POSTERS[$i]}" \
    --output "motion-output-$i" \
    --effect parallax
done

echo "Done! Check motion-output-*/ directories"
```

Make it executable and run:

```bash
chmod +x test-multiple.sh
./test-multiple.sh
```

---

## 🎨 Posters from your own Plex/Jellyfin / Emby

### Method 1: Via Posterrama API

If you're already running Posterrama:

```bash
# Fetch posters via API
curl http://localhost:4000/get-media?count=10 > media.json

# Extract poster URLs (with jq)
cat media.json | jq -r '.movies[].poster' > poster-urls.txt

# Generate motion for each
while read url; do
  python motion-demo.py --input "$url" --output "motion-output-$(date +%s)"
done < poster-urls.txt
```

### Method 2: Direct from Plex/Jellyfin / Emby

```bash
# Plex poster URL format
https://plex.example.com/library/metadata/12345/thumb/1234567890

# Jellyfin poster URL format
https://jellyfin.example.com/Items/abc123/Images/Primary
```

Add auth header in script or download locally first.

---

## 📁 Output files

After generation you'll find:

```
motion-output/
├── motion_poster.mp4    ← The motion poster (play with VLC/mpv)
└── depth_map.png        ← Debug visualization (how AI sees depth)
```

**Depth map colors:**

- 🔴 Red/Yellow = Near (moves a lot)
- 🔵 Blue/Purple = Far away (moves little)

---

## 🐛 Troubleshooting

### "No module named 'torch'"

```bash
pip install -r motion-demo-requirements.txt
```

### "Failed to load model"

Check internet connection (first time downloads ~100MB from torch hub)

### "Out of memory" (GPU)

Use CPU mode (omit `--gpu`) or smaller poster

### Video doesn't play

If you want to play it in a browser, install `ffmpeg` and regenerate so it encodes H.264.

### Poster too large/small

Script scales automatically, but for best results use 1000-2000px width

---

## 🎯 How to evaluate?

### Good motion poster:

✅ Foreground moves more than background  
✅ Seamless loop (no visible cut)  
✅ Smooth motion (no judder)  
✅ Detail preserved (no blur/artifacts)

### Test cases:

1. **Busy poster** (many elements) - Blade Runner
2. **Simple poster** (big face) - character close-up
3. **Landscape poster** (environment) - Interstellar space
4. **Dark poster** (low light) - horror posters

### Decide:

- ❌ If parallax is too subtle/boring → try AnimateDiff
- ✅ If it's good enough → integrate into Posterrama
- 🤔 If it's "ok" → test more posters, experiment with parameters

---

## ⏭️ Next Steps

**If demo is good:**

1. Integrate into Posterrama (Python service + Node.js API)
2. Build admin UI (generate button)
3. Create queue system (batch processing)
4. Storage management (cache limits)

**If demo is not good:**

1. Test AnimateDiff (more complex but better motion)
2. Test segmentation-based approach (per element animation)
3. Or skip feature entirely

**See:** `MOTION-POSTERS-POC.md` for full plan

---

## 💡 Tips

- Start with **3-4 posters** (diverse compositions)
- Test all 3 effects: `parallax`, `zoom`, `sway`
- Try `--intensity 0.5` to `2.0` to find sweet spot
- View `depth_map.png` to see what AI "sees"
- Play video in loop (mpv with `--loop`)

**Command to loop directly:**

```bash
mpv --loop motion-output/motion_poster.mp4
```

---

**Questions?** Check main POC doc: `MOTION-POSTERS-POC.md`
