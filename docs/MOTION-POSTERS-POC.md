# Motion Posters with AI - POC Plan

**Status:** Planning Phase  
**Target:** Proof of Concept - Depth-based Motion  
**Created:** 2025-11-01  
**Version:** 0.1.0

---

## 🎯 Goal

Develop a locally running system that converts static movie posters into subtly animated "motion posters" using AI, without dependency on external APIs or cloud services.

---

## 🎬 What are Motion Posters?

Motion posters are static film posters where **specific elements within the poster are animated**:

- Moving clouds
- Flickering fire
- Flowing water
- Blinking eyes
- Subtle parallax motion (depth effect)

Think "cinemagraph" style but fully AI-generated from a static image.

---

## 📋 Requirements & Constraints

### Functional

- ✅ Runs locally (no cloud dependencies)
- ✅ Works without GPU (CPU fallback)
- ✅ Optional GPU acceleration for speed
- ✅ Automatic dependency installation
- ✅ Seamless integration with existing Posterrama modes
- ✅ Opt-in per poster or collection (not all 10,000+ posters)

### Technical

- ⚡ CPU generation: 10-30 seconds per poster (acceptable for batch)
- ⚡ GPU generation: 2-5 seconds per poster (acceptable for on-demand)
- 💾 Output file size: 5-20MB per motion poster
- 🔄 Seamless video loop (3-5 seconds)
- 📱 Playback on low-end devices (HTML5 video)

### User Experience

- Admin panel: "Generate Motion" knop per poster
- Progress indicator tijdens generatie
- Queue systeem voor batch processing
- Fallback naar statische poster bij falen
- Cache management (disk space limits)

---

## 🏗️ POC Architecture

### Phase 1: Depth-based Motion (POC) ⭐

**Why this approach for POC:**

- Smallest model (~100MB MiDaS)
- Fastest implementation (1-2 days)
- Guaranteed to work on CPU
- Visually impressive enough to validate concept
- No complex dependencies

**Tech Stack:**

```
┌─────────────────────────────────────────────────┐
│  Posterrama Node.js Server (Express)            │
│  ├─ /api/motion/generate                        │
│  ├─ /api/motion/status/:jobId                   │
│  └─ /api/motion/queue                           │
└─────────────────┬───────────────────────────────┘
                  │ HTTP/JSON
┌─────────────────▼───────────────────────────────┐
│  Python AI Service (FastAPI)                    │
│  ├─ PyTorch                                     │
│  ├─ MiDaS (depth estimation)                    │
│  ├─ OpenCV (video generation)                   │
│  └─ FFmpeg (video encoding)                     │
└─────────────────┬───────────────────────────────┘
                  │ File I/O
┌─────────────────▼───────────────────────────────┐
│  Storage                                        │
│  ├─ media/posters/            (originals)       │
│  ├─ media/motion/             (generated)       │
│  └─ cache/motion-jobs.json    (queue state)     │
└─────────────────────────────────────────────────┘
```

### Pipeline Flow

```
1. INPUT
   ├─ User clicks "Generate Motion" in admin
   ├─ Node.js creates job in queue
   └─ Returns jobId

2. PROCESSING
   ├─ Python service picks up job
   ├─ Download poster from URL
   ├─ MiDaS generates depth map
   ├─ Apply parallax/zoom based on depth
   ├─ Generate 60-90 frames (3-5 sec @ 24fps)
   ├─ Encode to MP4 with H.264
   └─ Save to media/motion/

3. OUTPUT
   ├─ Update job status: complete
   ├─ Node.js serves motion poster
   └─ Frontend displays as HTML5 video loop
```

---

## 🔧 Technical Details

### Depth-based Motion Technique

**MiDaS Depth Estimation:**

```python
# Pseudo-code concept
depth_map = midas_model(poster_image)  # 0.0 (far) → 1.0 (near)

# Generate frames with parallax effect
for frame in range(90):  # 3 sec @ 30fps
    offset = sin(frame / 90 * 2π) * 20px  # Smooth back-and-forth motion

    # Near elements move more (parallax)
    for pixel in image:
        displacement = depth_map[pixel] * offset
        new_position = pixel + displacement

    save_frame(frame)

# Encode to video
ffmpeg -i frames/%03d.png -c:v libx264 -pix_fmt yuv420p output.mp4
```

**Effects possible with depth:**

- ✅ Parallax (foreground moves more than background)
- ✅ Ken Burns zoom (zoom in on interesting area)
- ✅ Subtle sway (gentle back-and-forth)
- ✅ Fake 3D rotation (slight perspective shift)

### Video Specifications

```javascript
{
  codec: "H.264",
  container: "MP4",
  resolution: "original aspect ratio, max 1920x1080",
  fps: 24,
  duration: "3-5 seconds",
  loop: true,
  bitrate: "2-4 Mbps",
  fileSize: "5-15 MB"
}
```

---

## 📦 Dependencies & Installation

### Python Environment

```bash
# Python 3.9+
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu  # CPU
# pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118  # GPU

pip install fastapi uvicorn
pip install opencv-python-headless
pip install timm  # For MiDaS
pip install Pillow numpy

# FFmpeg (system level)
apt-get install ffmpeg  # Debian/Ubuntu
brew install ffmpeg     # macOS
```

### Model Download

```python
# Auto-download on first run (±100MB)
model = torch.hub.load("intel-isl/MiDaS", "DPT_Large")
```

### Node.js Integration

```javascript
// server.js - new endpoints
app.post('/api/motion/generate', adminAuth, async (req, res) => {
    const { posterId, posterUrl, quality } = req.body;

    // Create job in queue
    const jobId = generateJobId();
    await motionQueue.addJob({
        jobId,
        posterId,
        posterUrl,
        quality: quality || 'medium',
        status: 'pending',
        createdAt: Date.now(),
    });

    // Trigger Python service (async)
    triggerMotionGeneration(jobId);

    res.json({ jobId, status: 'pending' });
});
```

---

## 🎨 Frontend Integration

### Admin Panel

```html
<!-- Add to admin poster card -->
<button onclick="generateMotion('movie-123')" class="btn-motion">✨ Generate Motion</button>

<div id="motion-progress" style="display:none">
    <progress id="motion-bar" value="0" max="100"></progress>
    <span id="motion-status">Generating depth map...</span>
</div>
```

### Display Mode Updates

```javascript
// screensaver.js / wallart.js
function showPoster(poster) {
    if (poster.hasMotion && config.motionPosters.enabled) {
        displayMotionPoster(poster.motionUrl);
    } else {
        displayStaticPoster(poster.url);
    }
}

function displayMotionPoster(url) {
    const video = document.createElement('video');
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    container.appendChild(video);
}
```

---

## ⚙️ Configuration Schema

```javascript
// config.json additions
{
  "motionPosters": {
    "enabled": false,
    "backend": "depth",  // "depth" (POC) | "animateDiff" (future)
    "useGPU": "auto",    // "auto" | true | false
    "quality": "medium", // "low" | "medium" | "high"
    "generation": {
      "maxConcurrent": 2,           // Max parallel jobs
      "fps": 24,                     // Output framerate
      "duration": 4,                 // Seconds
      "effect": "parallax",          // "parallax" | "zoom" | "sway"
      "intensity": 0.5               // 0.0-1.0
    },
    "cache": {
      "enabled": true,
      "maxSize": "50GB",             // Total disk limit
      "expireAfter": 90,             // Days (0 = never)
      "location": "media/motion/"
    },
    "autoGenerate": {
      "enabled": false,
      "triggers": ["new_media", "manual"],
      "filters": {
        "minRating": 7.0,            // Only good movies
        "genres": [],                // Empty = all
        "collections": []            // Specific collections only
      }
    }
  }
}
```

---

## 📊 POC Success Criteria

### Must Have

- [x] Python service draait lokaal
- [x] MiDaS model download werkt automatisch
- [x] Depth map generatie succesvol
- [x] Video output met parallax effect
- [x] Seamless loop (geen zichtbare cut)
- [x] Node.js kan Python service aanroepen
- [x] Admin panel heeft "Generate" knop
- [x] Progress tracking werkt
- [x] Motion poster toont in screensaver mode

### Nice to Have

- [ ] GPU auto-detection
- [ ] Batch queue processing
- [ ] Disk space monitoring
- [ ] Preview thumbnail in admin
- [ ] Multiple effect presets (parallax, zoom, sway)

### Performance Targets

- CPU generation: < 30 seconds
- GPU generation: < 5 seconds
- File size: < 20MB per poster
- Memory usage: < 2GB during generation
- No crashes with 10+ concurrent generations

---

## 🚀 Implementation Roadmap

### Week 1: Foundation

**Day 1-2: Python Service Setup**

- [ ] FastAPI boilerplate
- [ ] MiDaS integration
- [ ] Basic depth → parallax pipeline
- [ ] MP4 output met FFmpeg

**Day 3-4: Node.js Integration**

- [ ] API endpoints (/api/motion/\*)
- [ ] Job queue systeem
- [ ] File storage structuur
- [ ] Config schema updates

**Day 5: Frontend**

- [ ] Admin panel UI
- [ ] Progress tracking
- [ ] Video playback in display modes

### Week 2: Polish & Testing

**Day 6-7: Optimization**

- [ ] GPU detection & fallback
- [ ] Memory management
- [ ] Error handling
- [ ] Logging & monitoring

**Day 8-9: Testing**

- [ ] Test op diverse posters (landscape, portrait, busy, minimal)
- [ ] Performance benchmarks (CPU vs GPU)
- [ ] Edge cases (corrupt images, timeouts)
- [ ] User acceptance testing

**Day 10: Documentation**

- [ ] User guide (How to enable motion posters)
- [ ] Admin guide (Generate, manage, troubleshoot)
- [ ] Developer docs (Extend with new effects)

---

## 🔮 Future Enhancements (Post-POC)

### Phase 2: Advanced AI Motion

**AnimateDiff Integration:**

- Real AI-generated movement (clouds, fire, water)
- Better quality but slower (5-15 min CPU)
- Models: Stable Diffusion 1.5 + AnimateDiff (~6GB)
- Requires more VRAM (8GB+ GPU recommended)

### Phase 3: Smart Segmentation

**Element Detection + Targeted Animation:**

- Segment Anything Model (SAM) detects elements
- Separate animation per element (clouds drift differently than fire)
- Combination of AI + procedural
- More control, consistent results

### Phase 4: User Customization

- Effect presets per genre (Horror = flicker, Sci-Fi = glow)
- User can adjust intensity/speed per poster
- A/B testing of effects
- Share community presets

---

## 🐛 Risks & Mitigations

### Risk 1: MiDaS depth maps not accurate

**Impact:** Weird artifacting in motion  
**Mitigation:** Fallback to simple zoom/sway, no depth

### Risk 2: FFmpeg encoding too slow

**Impact:** CPU generation > 60 seconds  
**Mitigation:** Lower resolution, adjust bitrate, hardware encoder

### Risk 3: File sizes too large

**Impact:** Disk space fills up quickly  
**Mitigation:** Aggressive compression, WebM format option, cache limits

### Risk 4: Python service crashes

**Impact:** Queue stops, no new motion posters  
**Mitigation:** Health check endpoint, auto-restart, graceful degradation

### Risk 5: GPU out of memory

**Impact:** Crash during generation  
**Mitigation:** Detect VRAM, auto-fallback to CPU, batch size limits

---

## 📝 Open Questions

1. **Model hosting:** Include models in repo (100MB) or download on install?
    - **Decision:** Download on first run (keep repo small)

2. **Video format:** MP4 (universal) vs WebM (better compression)?
    - **Decision:** MP4 for POC (compatibility), WebM optional later

3. **Transition:** Cross-fade between static → motion in display mode?
    - **Decision:** Direct motion if available, no fade (keeps code simple)

4. **Admin UX:** Generate all button or always manual per poster?
    - **Decision:** Manual for POC, batch later

5. **Playback:** Preload next motion video for seamless transitions?
    - **Decision:** Yes, preload buffer of 2 videos

---

## 🎯 POC Demo Scenario

**Setup:**

1. Admin opens Posterrama admin panel
2. Navigates to Media Library
3. Selects "Inception" poster

**Action:** 4. Clicks "Generate Motion Poster" 5. Python service generates depth map (5 sec) 6. Creates parallax video (15 sec) 7. Progress bar updates real-time

**Result:** 8. Motion poster available 9. Screensaver mode shows animated poster 10. Subtle movement visible (foreground moves more than background) 11. Seamless 4-second loop

**Success if:**

- Entire flow < 30 seconds
- Video loops seamlessly
- No crashes or errors
- Visual effect is subtle but noticeable
- User understands how to use it

---

## 📚 Resources & References

### Papers & Models

- [MiDaS: Towards Robust Monocular Depth Estimation](https://arxiv.org/abs/1907.01341)
- [Intel ISL MiDaS GitHub](https://github.com/isl-org/MiDaS)

### Similar Projects

- Plotaverse (commercial motion photo app)
- Runway Gen-2 (cloud-based, inspiration)
- DepthAnything (alternative depth model)

### Tools

- FFmpeg documentation: https://ffmpeg.org/documentation.html
- FastAPI: https://fastapi.tiangolo.com/
- PyTorch: https://pytorch.org/

---

## ✅ Next Steps

1. **Review & Approve POC Plan** (this document)
2. **Setup Python development environment**
3. **Test MiDaS model locally** (validate it works)
4. **Build minimal Python service** (single endpoint: poster → video)
5. **Test output quality** (iterate on effect parameters)
6. **Integrate with Node.js** (job queue, API)
7. **Frontend integration** (admin + display modes)
8. **POC Demo & Decision** (continue to production or pivot?)

---

**Document Owner:** AI Agent + User  
**Last Updated:** 2025-11-01  
**Status:** Ready for Review
