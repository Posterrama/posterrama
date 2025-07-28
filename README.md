# Posterrama

[![Coverage Status](https://img.shields.io/badge/coverage-62%25-orange)](./coverage/lcov-report/index.html)
[![Tests](https://img.shields.io/badge/tests-121%20passing-brightgreen)](#testing)
[![Node.js Version](https://img.shields.io/badge/node.js-%E2%89%A518.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](./LICENSE)

An elegant, full-screen screensaver that acts as a digital art frame for your media collection.

Posterrama transforms your screen into a beautiful display that fetches and shows movie backgrounds, posters, and metadata from your Plex media server with cinematic Ken Burns effects and rich information overlays.

![Screenshot of screensaver](./screenshots/screensaver.png)

![Screenshot of admin](./screenshots/admin.png)


## Features

### 🎬 Media Server Integration
*   **Plex Integration**: Seamless integration with your Plex Media Server
*   **Dynamic Display**: Shows movie and series backgrounds with cinematic Ken Burns effects
*   **Rich Metadata**: Displays posters, titles, taglines, release years, and ratings
*   **Smart Caching**: Intelligent caching system for faster loading and reduced server load

### 🎨 Visual Experience
*   **ClearLogo Integration**: Shows movie or series logos for a clean, professional look
*   **Rotten Tomatoes**: Displays "Fresh", "Rotten", or "Certified Fresh" badges
*   **Customizable Widgets**: Configurable clock and display elements
*   **Responsive Design**: Optimized for full-screen display on any resolution

### 🔐 Security & Administration
*   **Secure Admin Panel**: Full-featured web-based administration interface
*   **Enhanced Security**: Admin accounts protected with hashed passwords
*   **Two-Factor Authentication (2FA)**: TOTP-based 2FA support for enhanced security
*   **Session Management**: Secure session handling with file-based storage
*   **API Key Authentication**: Support for API key-based authentication
*   **OAuth Integration**: OAuth provider support for external authentication
*   **Role-Based Access Control (RBAC)**: Granular permission system
*   **Password Reset**: Secure password recovery functionality

### 🚀 Performance & Reliability
*   **Process Management**: Runs stably with PM2, including automatic restarts
*   **Health Monitoring**: Comprehensive health check endpoints for system monitoring
*   **Rate Limiting**: Built-in API throttling and abuse prevention
*   **Error Handling**: Robust error management with detailed logging
*   **Input Validation**: Comprehensive request validation and sanitization
*   **Memory Management**: Automatic memory usage monitoring and optimization

### 📊 Developer Experience
*   **API Documentation**: Built-in Swagger UI for API exploration and testing
*   **Comprehensive Testing**: 121 test cases with 62% code coverage
*   **Test-Driven Development**: TDD approach with Jest and Supertest
*   **Logging System**: Advanced Winston-based logging with live log viewer
*   **Metrics Dashboard**: Real-time performance monitoring and analytics
*   **CI/CD Ready**: Automated testing and deployment pipeline support

## Requirements

*   **Node.js**: Version 18.x or higher
    *   **Windows & macOS**: Download the official installer from [nodejs.org](https://nodejs.org/en/download/)
    *   **Linux**: The versions available in default system repositories are often outdated. Use the official NodeSource repositories for the latest versions:

        **Debian/Ubuntu:**
        ```bash
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ```

        **RHEL/CentOS/Fedora:**
        ```bash
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
        ```

        **Arch Linux:**
        ```bash
        sudo pacman -S nodejs npm
        ```

*   **PM2**: Process manager for Node.js applications
    ```bash
    npm install -g pm2
    ```

*   **Media Server**: Access to a configured Plex Media Server with appropriate permissions

## Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/mfrelink/posterrama.git
    cd posterrama
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Create environment configuration**

    Copy the example environment file and configure your media server details:

    ```bash
    cp config.example.env .env
    ```

4.  **Configure your media server**

    Edit the `.env` file with your Plex server details:

    ```env
    # Plex Server Configuration
    PLEX_HOSTNAME="192.168.1.10"
    PLEX_PORT="32400"
    PLEX_TOKEN="YourPlexTokenHere"
    
    # Optional: Application Configuration
    PORT="4000"
    NODE_ENV="production"
    ```

5.  **Start the application**

    Use PM2 for production deployment with automatic restarts:

    ```bash
    pm2 start ecosystem.config.js
    ```

    Or for development:

    ```bash
    npm run dev
    ```

6.  **Set up automatic startup (Optional)**

    Configure PM2 to start automatically on system boot:

    ```bash
    pm2 startup
    # Run the command provided by PM2 output
    pm2 save
    ```

7.  **Verify installation**

    Check that the application is running:
    ```bash
    pm2 status
    pm2 logs posterrama
    ```

## Configuration

### Initial Setup

1.  **Admin Account Setup**

    Navigate to `http://<your-server-ip>:4000/admin/setup` to create your admin account:
    - Choose a strong username and password
    - Enable Two-Factor Authentication (2FA) for enhanced security
    - Save your recovery codes securely

2.  **Media Server Configuration**

    Access the admin panel at `http://<your-server-ip>:4000/admin` to configure:
    - **Plex Server Settings**: Hostname, port, and authentication token
    - **Library Selection**: Choose which Plex libraries to display
    - **Display Options**: Customize poster display, metadata, and visual effects
    - **Security Settings**: Configure authentication methods and access controls

### Available URLs

*   **Screensaver**: `http://<your-server-ip>:4000` - Full-screen media display
*   **Admin Panel**: `http://<your-server-ip>:4000/admin` - Administrative interface
*   **API Documentation**: `http://<your-server-ip>:4000/api-docs` - Interactive API documentation
*   **Health Check**: `http://<your-server-ip>:4000/health` - System health status

## Troubleshooting

### Common Issues

**No media is visible:**
1. Check application logs: `pm2 logs posterrama`
2. Verify Plex server connection in Admin Panel using "Test Connection"
3. Ensure at least one movie or TV show library is selected
4. Check that your Plex token has appropriate permissions

**Application not starting:**
1. Verify Node.js version: `node --version` (requires 18.x or higher)
2. Check environment configuration in `.env` file
3. Ensure all dependencies are installed: `npm install`
4. Check for port conflicts: `lsof -i :4000`

**Authentication issues:**
1. Clear browser cookies and try again
2. Check if 2FA is enabled and use the correct TOTP code
3. Verify session files in `sessions/` directory
4. Reset admin password through setup process if needed

**Performance issues:**
1. Monitor memory usage: `pm2 monit`
2. Check logs for errors: `pm2 logs posterrama --lines 100`
3. Clear image cache: `/api/admin/cache/clear`
4. Restart application: `pm2 restart posterrama`

### Debug Mode

Enable detailed logging by setting debug mode in the Admin Panel or environment:

```bash
# In .env file
DEBUG_MODE=true

# Or set in Admin Panel > Settings > Enable Debug Mode
```

### Health Check

Monitor application health and dependencies:

```bash
# Basic health check
curl http://localhost:4000/health

# Detailed health information
curl http://localhost:4000/health/detailed
```

### Getting Help

- Check the [Issues](https://github.com/mfrelink/posterrama/issues) page for known problems
- Review the API documentation at `/api-docs` for integration help
- Enable debug logging for detailed error information

## License

This project is licensed under the **GPL-3.0-or-later** license. See the [LICENSE](./LICENSE) file for full details.

### What this means:
- You can freely use, modify, and distribute this software
- Any modifications or derivative works must also be open source under GPL-3.0
- Commercial use is allowed
- No warranty is provided

---

**Posterrama** - Transform your screen into a beautiful digital art frame for your media collection.