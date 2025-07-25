# posterrama.app

**posterrama.app** is an elegant, full-screen screensaver that acts as a digital art frame for your media. It fetches beautiful backgrounds and posters from your Plex or Jellyfin media server and displays them with a subtle Ken Burns effect.

![Screenshot of posterrama.app](https://user-images.githubusercontent.com/example/screenshot.png) <!-- Replace this with a real screenshot URL -->

## Features

*   **Multiple Sources**: Works with both Plex and Jellyfin.
*   **Dynamic Display**: Shows movie and series backgrounds with a cinematic Ken Burns effect.
*   **Rich Metadata**: Displays posters, titles, taglines, year, and ratings.
*   **Integraties**:
    *   **ClearLogo**: Toont het logo van de film of serie.
    *   **Rotten Tomatoes**: Geeft een "Fresh", "Rotten" of "Certified Fresh" badge weer.
*   **Aanpasbare Widgets**: Inclusief een configureerbare klok.
*   **Web-based Admin Paneel**: Eenvoudig te configureren via een webinterface, inclusief het testen van de serververbinding en het selecteren van bibliotheken.
*   **Procesbeheer**: Draait stabiel met PM2, inclusief automatisch herstarten bij wijzigingen.
*   **Integrations**:
    *   **ClearLogo**: Shows the movie or series logo.
    *   **Rotten Tomatoes**: Displays a "Fresh", "Rotten", or "Certified Fresh" badge.
*   **Customizable Widgets**: Includes a configurable clock.
*   **Web-based Admin Panel**: Easy to configure via a web interface, including testing the server connection and selecting libraries.
*   **Process Management**: Runs stably with PM2, including automatic restarts on changes.

## Vereisten

*   **Node.js**: versie 16.x of hoger.
*   **npm**: Wordt meegeleverd met Node.js.
*   **PM2**: Een process manager voor Node.js. Installeer het wereldwijd:
## Requirements

*   **Node.js**: version 16.x or higher.
*   **npm**: Included with Node.js.
*   **PM2**: A process manager for Node.js. Install it globally:
    ```bash
    npm install -g pm2
    ```
*   **Media Server**: Toegang tot een geconfigureerde Plex of Jellyfin server.
*   **Media Server**: Access to a configured Plex or Jellyfin server.

## Installation

1.  **Clone de repository**
1.  **Clone the repository**
    ```bash
    git clone https://github.com/jouw-gebruiker/posterrama.app.git
    cd posterrama.app
    ```

2.  **Installeer de afhankelijkheden**
2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Maak het configuratiebestand voor geheimen**

3.  **Create the configuration file for secrets**

    Copy the example environment file to a new `.env` file. This file contains secret keys and tokens and is not tracked by version control.

    ```bash
    cp config.example.env .env
    ```

4.  **Vul het `.env` bestand in**

4.  **Fill in the `.env` file**

    Open the `.env` file with a text editor and enter your media server details.

    *Example for Plex:*
    ```env
    # Plex Server Details
    PLEX_HOSTNAME="192.168.1.10"
    PLEX_PORT="32400"
    PLEX_TOKEN="JouwPlexTokenHier"
    ```

5.  **Start de applicatie met PM2**

    PM2 zorgt ervoor dat de applicatie op de achtergrond draait en automatisch herstart bij crashes of wijzigingen in de code.

    ```bash
    pm2 start ecosystem.config.js
    ```

6.  **Controleer de status**

    Je kunt de status en logs van de applicatie bekijken met:
    ```bash
    pm2 status
    pm2 logs posterrama
    ```

## Configuration

De applicatie gebruikt twee configuratiebestanden:

*   `.env`: Voor geheimen en server-specifieke instellingen (hostname, poort, tokens).
*   `config.json`: Voor weergave-instellingen (transitie-interval, welke widgets tonen, etc.).

De eenvoudigste manier om de applicatie te configureren is via het **Admin Paneel**.

### Eerste Setup van het Admin Paneel

1.  Navigeer in je browser naar `http://<jouw-server-ip>:4000/admin/setup`.
2.  Maak een beheerdersaccount aan. Deze gegevens worden veilig opgeslagen in het `.env` bestand.
3.  Na de setup word je doorgestuurd naar de login-pagina.

### Gebruik van het Admin Paneel

*   **URL**: `http://<jouw-server-ip>:4000/admin`
*   Hier kun je alle instellingen aanpassen, zoals:
    *   De Plex/Jellyfin server in- of uitschakelen.
    *   Bibliotheken selecteren waaruit media moet worden getoond.
    *   De weergave van de poster, metadata, ClearLogo en Rotten Tomatoes badge aanpassen.
    *   De applicatie herstarten na het wijzigen van kritieke instellingen (zoals de poort).

## Gebruik

*   **Screensaver**: Open `http://<jouw-server-ip>:4000` in een browser.
*   **Admin Paneel**: Open `http://<jouw-server-ip>:4000/admin`.

## API Documentatie

De applicatie heeft een interne API die wordt gebruikt door de frontend. Met de toevoeging van Swagger UI is deze API nu gedocumenteerd en interactief te verkennen. Dit is vooral handig voor ontwikkelaars of voor wie de werking van de applicatie beter wil begrijpen.

*   **Swagger UI**: Open `http://<jouw-server-ip>:4000/api-docs` in een browser.


## Troubleshooting

*   **Geen media zichtbaar**:
    1.  Controleer de logs met `pm2 logs posterrama`.
    2.  Ga naar het Admin Paneel en gebruik de "Test Verbinding" knop om te controleren of de servergegevens correct zijn.
    3.  Zorg ervoor dat je ten minste één film- of seriebibliotheek hebt geselecteerd.
*   **Fouten na wijzigingen**:
    1.  Schakel "Enable Debug Mode" in via het Admin Paneel voor meer gedetailleerde logs.
    2.  Herstart de applicatie via de knop in het Admin Paneel of via de command line: `pm2 restart posterrama`.

## License

Dit project is gelicenseerd onder de GPL-3.0-or-later licentie. Zie het `LICENSE.md` bestand voor meer details.
