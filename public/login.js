// Login page fanart functionality
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Check if configuration exists and has media server configured
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            
            // Check if Plex is configured (has server and token)
            if (config.plex && config.plex.server && config.plex.token) {
                // Apply fanart background
                await loadFanartBackground();
            }
        }
    } catch (error) {
        console.log('No fanart available:', error);
    }
});

async function loadFanartBackground() {
    try {
        const response = await fetch('/api/fanart');
        if (response.ok) {
            const fanartData = await response.json();
            if (fanartData.fanart) {
                // Create background layer
                const backgroundLayer = document.createElement('div');
                backgroundLayer.className = 'login-background-layer';
                backgroundLayer.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image: url('${fanartData.fanart}');
                    background-size: cover;
                    background-position: center;
                    background-repeat: no-repeat;
                    opacity: 0.3;
                    z-index: -1;
                    filter: blur(2px);
                `;
                
                // Insert background layer
                document.body.insertBefore(backgroundLayer, document.body.firstChild);
                
                // Update auth-container to have less opacity so fanart shows through
                const authContainer = document.querySelector('.auth-container');
                if (authContainer) {
                    authContainer.style.background = `
                        linear-gradient(135deg, 
                            rgba(15, 15, 35, 0.8) 0%, 
                            rgba(26, 26, 46, 0.8) 25%, 
                            rgba(22, 33, 62, 0.8) 50%, 
                            rgba(15, 52, 96, 0.8) 75%, 
                            rgba(83, 52, 131, 0.8) 100%
                        )
                    `;
                }
            }
        }
    } catch (error) {
        console.log('Failed to load fanart:', error);
    }
}
