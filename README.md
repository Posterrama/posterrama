# Posterrama

# An elegant, full-screen screensaver that acts as a digital art frame for your media.

It fetches beautiful backgrounds and posters from your Plex media server and displays them with a subtle Ken Burns effect.

![Screenshot of screensaver](./screenshots/screensaver.png)

![Screenshot of admin](./screenshots/admin.png)


## Features

*   **Plex Integration**: Works seamlessly with your Plex Media Server.
*   **Dynamic Display**: Shows movie and series backgrounds with a cinematic Ken Burns effect.
*   **Rich Metadata**: Displays posters, titles, taglines, year, and ratings.
*   **Integrations**:
    *   **ClearLogo**: Shows the movie or series logo for a clean look.
    *   **Rotten Tomatoes**: Displays a "Fresh", "Rotten", or "Certified Fresh" badge.
*   **Secure Admin Panel**: A full-featured, web-based admin panel to configure the application without touching any files.
*   **Enhanced Security**: The admin account is protected by a hashed password and supports **Two-Factor Authentication (2FA)**.
*   **API Documentation**: Comes with a built-in Swagger UI to explore and understand the API.
*   **Customizable Widgets**: Includes a configurable clock.
*   **Process Management**: Runs stably with PM2, including automatic restarts on changes.

## Requirements

*   **Node.js**: version 18.x or higher.
    *   **Windows & macOS**: Download the official installer from [nodejs.org](https://nodejs.org/en/download/).
    *   **Linux**: Installing a recent version of Node.js on Linux requires a few extra steps. The versions available in the default system repositories (e.g., via `apt` or `yum`) are often outdated and **will not work** with this application. The recommended method is to use the official NodeSource repositories, which always provide the latest versions.

        **Recommended Installation (via NodeSource):**

        *   **Debian, Ubuntu, and derivatives:**
            ```bash
            # This command adds the NodeSource repository for Node.js v18
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            # Then, install Node.js
            sudo apt-get install -y nodejs
            ```
        *   **RHEL, CentOS, Fedora, and derivatives:**
            ```bash
            # This command adds the NodeSource repository for Node.js v18
            curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
            # Then, install Node.js (use 'dnf' if 'yum' is not available)
            sudo yum install -y nodejs
            ```
        *   **Arch Linux:** The official Arch repositories are typically up-to-date. The standard installation command is usually sufficient.
            ```bash
            sudo pacman -S nodejs npm
            ```
*   **PM2**: A process manager for Node.js. Install it globally:
    ```bash
    npm install -g pm2
    ```
*   **Media Server**: Access to a configured Plex or Jellyfin server.

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

3.  **Create the configuration file for secrets**

    Copy the example environment file to a new `.env` file. This file contains secret keys and tokens and is not tracked by version control.

    ```bash
    cp config.example.env .env
    ```

4.  **Fill in the `.env` file**

    Open the `.env` file with a text editor and enter your media server details.

    *Example for Plex:*
    ```env
    # Plex Server Details
    PLEX_HOSTNAME="192.168.1.10"
    PLEX_PORT="32400"
    PLEX_TOKEN="YourPlexTokenHere"
    ```

5.  **Start the application with PM2**

    PM2 ensures the application runs in the background and automatically restarts after crashes or code changes.

    ```bash
    pm2 start ecosystem.config.js
    ```

6.  **Enable Automatic Startup on Boot (Recommended)**

    To ensure the application automatically starts when the server reboots, you need to set up the PM2 startup script.

    First, generate the startup command:
    ```bash
    pm2 startup
    ```
    PM2 will display a command that you need to copy and run. It will look something like this (the exact command may vary depending on your system):
    ```bash
    # Example for a systemd-based Linux system:
    sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u <your_username> --hp /home/<your_username>
    ```
    **Important:** Run the exact command provided by PM2 in your terminal.

    Finally, save the current process list so PM2 knows which applications to restart on boot:
    ```bash
    pm2 save
    ```

7.  **Check the status**

    You can view the application's status and logs with:
    ```bash
    pm2 status
    pm2 logs posterrama
    ```

## Configuration

The application is configured via the **Admin Panel**.

### Initial Admin Panel Setup

1.  Navigate to `http://<your-server-ip>:4000/admin/setup` in your browser.
2.  Create an admin account with a username and a strong password.
3.  After setup, you will be redirected to the login page. Log in with your new credentials.
4.  It is highly recommended to enable **Two-Factor Authentication (2FA)** immediately after logging in via the "Security" section in the admin panel for enhanced security.

### Using the Admin Panel

*   **URL**: `http://<your-server-ip>:4000/admin`
*   Here you can adjust all settings, such as:
    *   Enabling or disabling the Plex/Jellyfin server connection.
    *   Selecting which Plex libraries to fetch media from.
    *   Customizing the display of the poster, metadata, ClearLogo, and Rotten Tomatoes badge.
    *   Restarting the application after changing critical settings (like the port).

## Usage

*   **Screensaver**: Open `http://<your-server-ip>:4000` in a browser.
*   **Admin Panel**: Open `http://<your-server-ip>:4000/admin`.
*   **API Docs**: Open `http://<your-server-ip>:4000/api-docs` to view the Swagger API documentation.

## Troubleshooting

*   **No media is visible**:
    1.  Check the logs with `pm2 logs posterrama`.
    2.  Go to the Admin Panel and use the "Test Connection" button to verify that the server details are correct.
    3.  Ensure you have selected at least one movie or show library.
*   **Errors after changes**:
    1.  Enable "Enable Debug Mode" in the Admin Panel for more detailed logs.
    2.  Restart the application using the button in the Admin Panel or via the command line: `pm2 restart posterrama`.

## License

This project is licensed under the GPL-3.0-or-later license. See the `LICENSE` file for more details.