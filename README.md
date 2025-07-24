# posterrama.app

An elegant, web-based screensaver that dynamically displays posters and backdrops from your Plex and/or Jellyfin Media Server. Ideal for a second screen, a living room TV, or simply to showcase your love for your media collection.

Author: Mark Frelink  
License: AGPL-3.0-or-later

## Key Features

*   **Direct Plex Integration**: Connects to your Plex server to fetch media.
*   **Dynamic Display**: Shows a random selection of movies and/or TV shows.
*   **Visually Engaging**: Uses fanart as a background with a subtle "Ken Burns" zoom effect.
*   **Detailed Information**: Displays the poster, title, tagline, year, and rating.
*   **ClearLogo Support**: If a ClearLogo is available, it is prominently displayed.
*   **Widgets**: Includes a configurable clock and a sidebar with "Recently Added" media.
*   **Interactive**: Pause the slideshow or navigate manually through items.
*   **Secure**: Uses an image proxy so your Plex token is never exposed to the browser.

## Installation

1.  **Download the code**
    Clone this repository or download the files to a directory on your computer or server.
    ```bash
    git clone <repository_url>
    cd posters
    ```

2.  **Install Dependencies**
    This project uses Node.js. Make sure you have Node.js and npm installed. Then, run the following command in the project directory:
    ```bash
    npm install
    ```
    This command installs all necessary dependencies as defined in `package.json`, including the stable version of the Express.js framework.

## Configuration

The configuration is split into two files:
1.  `.env`: For secrets and environment-specific values (like IP addresses, ports, and tokens).
2.  `config.json`: For defining the media servers and configuring the application's behavior.

1.  **Create a `.env` file**
    Copy the example file `config.example.env` to a new file named `.env` in the project root.
    ```bash
    cp config.example.env .env
    ```
    **Important:** The `.env` file contains sensitive information and should **never** be committed to version control (like Git). The provided `.gitignore` file already ignores this file.

2.  **Edit your `.env` file**
    Fill in the values for the variables you will use in `config.json`.
    ```dotenv
    # Example configuration for a Plex server
    PLEX_HOSTNAME=192.168.1.100
    PLEX_PORT=32400
    PLEX_TOKEN=YourPlexTokenHere

    # Example configuration for a Jellyfin server
    JELLYFIN_URL=http://192.168.1.101:8096
    JELLYFIN_API_KEY=YourJellyfinApiKey
    JELLYFIN_USER_ID=YourJellyfinUserId
    
    # Application configuration (Optional)
    SERVER_PORT=4000
    DEBUG=false
    ```

3.  **Adjust `config.json`**
    In this file, you define which media servers you want to use. You can add multiple servers (for example, Plex, and in the future, Emby or Jellyfin).
    
```json
{
  "mediaServers": [
    {
      "name": "Plex Server",
      "type": "plex",
      "enabled": true,
      "hostnameEnvVar": "PLEX_HOSTNAME",
      "portEnvVar": "PLEX_PORT",
      "tokenEnvVar": "PLEX_TOKEN",
      "movieLibraryNames": ["Movies", "Kids Movies"],
      "showLibraryNames": ["TV Shows"],
      "movieCount": 30,
      "showCount": 15
    },
    {
      "name": "Jellyfin Server",
      "type": "jellyfin",
      "enabled": true,
      "urlEnvVar": "JELLYFIN_URL",
      "apiKeyEnvVar": "JELLYFIN_API_KEY",
      "userIdEnvVar": "JELLYFIN_USER_ID",
      "movieLibraryNames": ["Movies"],
      "showLibraryNames": ["TV Shows"],
      "movieCount": 20,
      "showCount": 15
    }
  ],
  "transitionIntervalSeconds": 15,
  "backgroundRefreshMinutes": 30,
  "showClearLogo": true,
  "recentlyAddedSidebar": true,
  "clockWidget": true,
  "kenBurnsEffect": {
    "enabled": true,
    "durationSeconds": 20
  }
}
```

### Explanation of the Options

#### `.env` file
*   **`..._HOSTNAME`**: (Required) The IP address or hostname of your media server.
*   **`..._PORT`**: (Required) The port of your media server (e.g., `32400` for Plex).
*   **`..._TOKEN`**: (Required for Plex) Your personal authentication token for the media server.
*   **`..._URL`**: (Required for Jellyfin) The full URL to your Jellyfin server (e.g., `http://jellyfin.local:8096`).
*   **`..._API_KEY`**: (Required for Jellyfin) An API key generated in your Jellyfin dashboard.
*   **`..._USER_ID`**: (Required for Jellyfin) The ID of the user whose libraries should be used.
*   **`SERVER_PORT`**: (Optional) The port on which this application's web server runs. Default is `4000`.
*   **`DEBUG`**: (Optional) Set to `true` to enable additional logs and the `/debug` endpoint. Default is `false`.

#### `config.json` file
*   **`mediaServers`**: An array of server objects. For each server:
    *   **`name`**: A unique name for your server (e.g., "Living Room Plex").
    *   **`type`**: The type of server. Supported types: `"plex"`, `"jellyfin"`.
    *   **`enabled`**: Set to `true` to use this server, `false` to disable.
    *   **`...EnvVar`**: The names of the variables in your `.env` file that hold the credentials for this server (e.g., `hostnameEnvVar`, `apiKeyEnvVar`).
    *   **`movieLibraryNames`**: An array of your movie library names.
    *   **`showLibraryNames`**: An array of your TV show library names.
    *   **`movieCount`**, **`showCount`**: The number of random items to fetch from the libraries for the playlist.
*   **`transitionIntervalSeconds`**: The time in seconds before showing the next item.
*   **`backgroundRefreshMinutes`**: The time in minutes before the media list is refreshed in the background. Set to `0` to disable.
*   **`showClearLogo`**: Set to `true` to show the ClearLogo at the top of the screen.
*   **`recentlyAddedSidebar`**: Set to `true` to show the sidebar with recently added items.
*   **`clockWidget`**: Set to `true` to show the clock in the top-left corner.
*   **`kenBurnsEffect`**: Settings for the background zoom effect.

## Running the Application

Start the server with the following command:

```bash
npm start
```

You will see a message indicating the server is running:  
`Plex Screensaver running at http://localhost:4000`

Now open your web browser and go to the displayed address (e.g., `http://localhost:4000` or `http://<server_ip>:4000`) to view the screensaver.

## Admin Interface

This application includes a web-based admin interface to manage your configuration without directly editing the `config.json` and `.env` files.

### First-Time Setup
1.  Navigate to `/admin` in your browser (e.g., `http://localhost:4000/admin`).
2.  You will be redirected to a setup page to create an admin user.
3.  Enter a username and a strong password. These credentials will be securely stored in your `.env` file.

### Accessing the Admin Panel
After the initial setup, you can log in at `/admin` with the credentials you created. Here you can modify all application settings.

**Note:** After saving changes in the admin panel, you may need to restart the application for them to take full effect.

## Running in Production with PM2

For stable operation in a production environment, it's recommended to use a process manager like PM2. PM2 ensures the application automatically restarts on crashes and can manage the application as a service.

A configuration file for PM2, `ecosystem.config.js`, is included in this project.

1.  **Install PM2 globally** (if not already installed):
    ```bash
    npm install pm2 -g
    ```

2.  **Start the application with PM2**:
    Navigate to the project folder and run:
    ```bash
    pm2 start ecosystem.config.js
    ```
    PM2 will now run and monitor the application in the background.

### Useful PM2 Commands

*   **View logs**:
    ```bash
    pm2 logs posterrama
    ```

*   **Check application status**:
    ```bash
    pm2 status
    ```

*   **Restart application**:
    ```bash
    pm2 restart posterrama
    ```

*   **Stop application**:
    ```bash
    pm2 stop posterrama
    ```

*   **Start on system boot**:
    PM2 can generate a script to automatically start the application on server boot.
    ```bash
    pm2 startup
    ```
    Follow the instructions given by this command. Then save the current process list:
    ```bash
    pm2 save
    ```

## License

This project is released under the **GNU Affero General Public License v3.0**. See the `LICENSE` file for more details.
