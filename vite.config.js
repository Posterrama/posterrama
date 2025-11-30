import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: 'public',

    build: {
        outDir: '../dist/public',
        emptyOutDir: true,

        minify: 'terser',
        // @ts-ignore - terserOptions type compatibility with Vite build options
        terserOptions: {
            // @ts-ignore
            compress: {
                drop_console: false, // Keep console logs for now
                drop_debugger: true,
            },
        },

        sourcemap: true,

        // Asset handling
        assetsInlineLimit: 4096, // Inline assets < 4KB as base64

        // Chunking strategy
        chunkSizeWarningLimit: 1000,

        rollupOptions: {
            input: {
                admin: resolve(__dirname, 'public/admin.html'),
                wallart: resolve(__dirname, 'public/wallart.html'),
                cinema: resolve(__dirname, 'public/cinema.html'),
                screensaver: resolve(__dirname, 'public/screensaver.html'),
                setup: resolve(__dirname, 'public/setup.html'),
                index: resolve(__dirname, 'public/index.html'),
                login: resolve(__dirname, 'public/login.html'),
                '2fa-verify': resolve(__dirname, 'public/2fa-verify.html'),
            },

            output: {
                manualChunks: {
                    // Vendor chunks for better caching
                    vendor: [
                        // Add any npm dependencies here when they exist
                    ],
                },

                // Naming strategy
                entryFileNames: 'assets/[name].[hash].js',
                chunkFileNames: 'assets/[name].[hash].js',
                assetFileNames: 'assets/[name].[hash].[ext]',
            },
        },
    },

    server: {
        port: 5173,
        strictPort: false,

        proxy: {
            // Proxy API calls to backend during development
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
            '/proxy': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:4000',
                ws: true,
            },
        },
    },

    preview: {
        port: 4173,
        strictPort: false,
    },
});
