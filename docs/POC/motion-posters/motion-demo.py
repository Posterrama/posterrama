#!/usr/bin/env python3
"""
Motion Poster Demo - Depth-based Parallax Generator
Standalone script to test motion poster generation using MiDaS depth estimation.

Usage:
    python motion-demo.py --input poster.jpg
    python motion-demo.py --input https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg
    python motion-demo.py --input poster.jpg --effect zoom --duration 5
"""

import argparse
import sys
import os
from pathlib import Path
import urllib.request
import time
import math

try:
    import torch
    import cv2
    import numpy as np
    from PIL import Image
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\n📦 Install with:")
    print("   pip install torch torchvision opencv-python-headless pillow numpy timm")
    sys.exit(1)


class MotionPosterGenerator:
    def __init__(self, device='cpu'):
        """Initialize the generator with MiDaS model."""
        self.device = device
        self.model = None
        self.transform = None
        
    def load_model(self):
        """Load MiDaS depth estimation model."""
        print("📥 Loading MiDaS model (first time will download ~100MB)...")
        start = time.time()
        
        try:
            # Load MiDaS model from torch hub
            self.model = torch.hub.load("intel-isl/MiDaS", "DPT_Large", trust_repo=True)
            self.model.to(self.device)
            self.model.eval()
            
            # Load transforms
            midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
            self.transform = midas_transforms.dpt_transform
            
            elapsed = time.time() - start
            print(f"✅ Model loaded in {elapsed:.1f}s")
            
        except Exception as e:
            print(f"❌ Failed to load model: {e}")
            sys.exit(1)
    
    def load_image(self, input_path):
        """Load image from file or URL."""
        print(f"📷 Loading image: {input_path}")
        
        if input_path.startswith('http://') or input_path.startswith('https://'):
            # Download from URL
            temp_file = '/tmp/poster_temp.jpg'
            try:
                urllib.request.urlretrieve(input_path, temp_file)
                input_path = temp_file
                print(f"   ✓ Downloaded to {temp_file}")
            except Exception as e:
                print(f"❌ Failed to download: {e}")
                sys.exit(1)
        
        if not os.path.exists(input_path):
            print(f"❌ File not found: {input_path}")
            sys.exit(1)
        
        # Load with PIL
        img = Image.open(input_path).convert('RGB')
        print(f"   ✓ Loaded {img.size[0]}x{img.size[1]} image")
        
        return img, np.array(img)
    
    def estimate_depth(self, image_pil):
        """Generate depth map from image."""
        print("🧠 Estimating depth map...")
        start = time.time()
        
        # Transform image for model
        input_batch = self.transform(image_pil).to(self.device)
        
        # Predict depth
        with torch.no_grad():
            prediction = self.model(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=image_pil.size[::-1],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        
        depth_map = prediction.cpu().numpy()
        
        # Normalize to 0-1
        depth_map = (depth_map - depth_map.min()) / (depth_map.max() - depth_map.min())
        
        elapsed = time.time() - start
        print(f"   ✓ Depth map generated in {elapsed:.1f}s")
        
        return depth_map
    
    def save_depth_visualization(self, depth_map, output_path):
        """Save depth map as grayscale image for debugging."""
        depth_vis = (depth_map * 255).astype(np.uint8)
        depth_colored = cv2.applyColorMap(depth_vis, cv2.COLORMAP_MAGMA)
        cv2.imwrite(output_path, depth_colored)
        print(f"   ✓ Depth map saved to {output_path}")
    
    def generate_parallax_frames(self, image, depth_map, num_frames=90, effect='parallax', intensity=1.0):
        """Generate frames with parallax motion based on depth."""
        print(f"🎬 Generating {num_frames} frames with '{effect}' effect...")
        start = time.time()
        
        frames = []
        height, width = image.shape[:2]
        
        for i in range(num_frames):
            # Create smooth oscillation (sine wave for seamless loop)
            t = i / num_frames
            phase = t * 2 * math.pi
            
            if effect == 'parallax':
                # Horizontal parallax movement
                offset_x = math.sin(phase) * 20 * intensity
                offset_y = math.cos(phase * 0.5) * 10 * intensity
                
                # Create displacement map
                frame = self._apply_parallax(image, depth_map, offset_x, offset_y)
                
            elif effect == 'zoom':
                # Ken Burns zoom effect
                zoom_factor = 1.0 + (math.sin(phase) * 0.1 * intensity)
                frame = self._apply_zoom(image, depth_map, zoom_factor)
                
            elif effect == 'sway':
                # Gentle sway (horizontal only)
                offset_x = math.sin(phase) * 15 * intensity
                frame = self._apply_parallax(image, depth_map, offset_x, 0)
                
            else:
                frame = image.copy()
            
            frames.append(frame)
            
            if (i + 1) % 30 == 0:
                print(f"   ⏳ {i+1}/{num_frames} frames...")
        
        elapsed = time.time() - start
        print(f"   ✓ Frames generated in {elapsed:.1f}s")
        
        return frames
    
    def _apply_parallax(self, image, depth_map, offset_x, offset_y):
        """Apply depth-based parallax displacement."""
        height, width = image.shape[:2]
        
        # Create meshgrid
        y_coords, x_coords = np.meshgrid(np.arange(height), np.arange(width), indexing='ij')
        
        # Apply displacement based on depth (closer = more movement)
        x_displaced = x_coords + (depth_map * offset_x).astype(np.float32)
        y_displaced = y_coords + (depth_map * offset_y).astype(np.float32)
        
        # Clip to valid range
        x_displaced = np.clip(x_displaced, 0, width - 1)
        y_displaced = np.clip(y_displaced, 0, height - 1)
        
        # Remap image
        frame = cv2.remap(
            image,
            x_displaced.astype(np.float32),
            y_displaced.astype(np.float32),
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE
        )
        
        return frame
    
    def _apply_zoom(self, image, depth_map, zoom_factor):
        """Apply depth-aware zoom effect."""
        height, width = image.shape[:2]
        
        # Calculate new dimensions
        new_height = int(height * zoom_factor)
        new_width = int(width * zoom_factor)
        
        # Resize image
        zoomed = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
        
        # Center crop back to original size
        y_offset = (new_height - height) // 2
        x_offset = (new_width - width) // 2
        
        if zoom_factor > 1.0:
            frame = zoomed[y_offset:y_offset+height, x_offset:x_offset+width]
        else:
            # Zoom out: pad with edge pixels
            frame = cv2.copyMakeBorder(
                zoomed,
                y_offset, y_offset,
                x_offset, x_offset,
                cv2.BORDER_REPLICATE
            )
            frame = cv2.resize(frame, (width, height))
        
        return frame
    
    def encode_video(self, frames, output_path, fps=30):
        """Encode frames to MP4 video."""
        print(f"🎥 Encoding video to {output_path}...")
        start = time.time()
        
        height, width = frames[0].shape[:2]
        
        # Define codec and create VideoWriter
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        if not out.isOpened():
            print("❌ Failed to open video writer")
            sys.exit(1)
        
        for frame in frames:
            # Convert RGB to BGR for OpenCV
            frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            out.write(frame_bgr)
        
        out.release()
        
        elapsed = time.time() - start
        file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"   ✓ Video encoded in {elapsed:.1f}s ({file_size_mb:.1f}MB)")
    
    def generate(self, input_path, output_dir='motion-output', effect='parallax', duration=4, fps=24, intensity=1.0):
        """Full pipeline: image → depth → frames → video."""
        print("\n" + "="*60)
        print("🎨 Motion Poster Generator - Demo")
        print("="*60 + "\n")
        
        # Setup
        os.makedirs(output_dir, exist_ok=True)
        
        # Load model
        if self.model is None:
            self.load_model()
        
        # Load image
        image_pil, image_np = self.load_image(input_path)
        
        # Generate depth map
        depth_map = self.estimate_depth(image_pil)
        
        # Save depth visualization
        depth_output = os.path.join(output_dir, 'depth_map.png')
        self.save_depth_visualization(depth_map, depth_output)
        
        # Generate frames
        num_frames = int(duration * fps)
        frames = self.generate_parallax_frames(image_np, depth_map, num_frames, effect, intensity)
        
        # Encode video
        video_output = os.path.join(output_dir, 'motion_poster.mp4')
        self.encode_video(frames, video_output, fps)
        
        # Summary
        print("\n" + "="*60)
        print("✅ Generation complete!")
        print("="*60)
        print(f"\n📁 Output files:")
        print(f"   • Motion video: {video_output}")
        print(f"   • Depth map:    {depth_output}")
        print(f"\n▶️  Play with: mpv {video_output}")
        print(f"   or open in your video player\n")


def main():
    parser = argparse.ArgumentParser(
        description='Generate motion posters with depth-based parallax',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # From local file
  python motion-demo.py --input poster.jpg
  
  # From URL
  python motion-demo.py --input https://image.tmdb.org/t/p/original/xyz.jpg
  
  # Different effects
  python motion-demo.py --input poster.jpg --effect zoom
  python motion-demo.py --input poster.jpg --effect sway --intensity 1.5
  
  # Longer duration
  python motion-demo.py --input poster.jpg --duration 6 --fps 30
  
Effects:
  parallax - Depth-based horizontal/vertical movement (default)
  zoom     - Ken Burns style zoom in/out
  sway     - Gentle horizontal sway only
        """
    )
    
    parser.add_argument('--input', '-i', required=True,
                        help='Input image path or URL')
    parser.add_argument('--output', '-o', default='motion-output',
                        help='Output directory (default: motion-output)')
    parser.add_argument('--effect', '-e', choices=['parallax', 'zoom', 'sway'],
                        default='parallax', help='Motion effect type')
    parser.add_argument('--duration', '-d', type=float, default=4.0,
                        help='Video duration in seconds (default: 4)')
    parser.add_argument('--fps', type=int, default=24,
                        help='Frames per second (default: 24)')
    parser.add_argument('--intensity', type=float, default=1.0,
                        help='Effect intensity multiplier (default: 1.0)')
    parser.add_argument('--gpu', action='store_true',
                        help='Use GPU if available')
    
    args = parser.parse_args()
    
    # Device selection
    if args.gpu and torch.cuda.is_available():
        device = 'cuda'
        print(f"🚀 Using GPU: {torch.cuda.get_device_name(0)}")
    else:
        device = 'cpu'
        print("🖥️  Using CPU (add --gpu to use GPU if available)")
    
    # Generate
    generator = MotionPosterGenerator(device=device)
    generator.generate(
        input_path=args.input,
        output_dir=args.output,
        effect=args.effect,
        duration=args.duration,
        fps=args.fps,
        intensity=args.intensity
    )


if __name__ == '__main__':
    main()
