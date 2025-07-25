# posterrama.app

**posterrama.app** is een elegante, full-screen screensaver die fungeert als een digitaal art-frame voor uw media. Het haalt prachtige achtergronden en posters van uw Plex of Jellyfin media server en toont ze met een subtiel Ken Burns-effect.

![Screenshot van posterrama.app](https://user-images.githubusercontent.com/example/screenshot.png) <!-- Vervang dit door een echte screenshot URL -->

## Features

*   **Meerdere Bronnen**: Werkt met zowel Plex als Jellyfin.
*   **Dynamische Weergave**: Toont film- en serie-achtergronden met een cinematisch Ken Burns-effect.
*   **Rijke Metadata**: Geeft posters, titels, taglines, jaartal en ratings weer.
*   **Integraties**:
    *   **ClearLogo**: Toont het logo van de film of serie.
    *   **Rotten Tomatoes**: Geeft een "Fresh", "Rotten" of "Certified Fresh" badge weer.
*   **Aanpasbare Widgets**: Inclusief een configureerbare klok.
*   **Web-based Admin Paneel**: Eenvoudig te configureren via een webinterface, inclusief het testen van de serververbinding en het selecteren van bibliotheken.
*   **Procesbeheer**: Draait stabiel met PM2, inclusief automatisch herstarten bij wijzigingen.

## Vereisten

*   **Node.js**: versie 16.x of hoger.
*   **npm**: Wordt meegeleverd met Node.js.
*   **PM2**: Een process manager voor Node.js. Installeer het wereldwijd:
    ```bash
    npm install -g pm2
    ```
*   **Media Server**: Toegang tot een geconfigureerde Plex of Jellyfin server.

## Installation

1.  **Clone de repository**
    ```bash
    git clone https://github.com/jouw-gebruiker/posterrama.app.git
    cd posterrama.app
    ```

2.  **Installeer de afhankelijkheden**
    ```bash
    npm install
    ```

3.  **Maak het configuratiebestand voor geheimen**

    Kopieer het voorbeeld-omgevingsbestand naar een nieuw `.env` bestand. Dit bestand bevat de geheime sleutels en tokens en wordt niet meegenomen in versiebeheer.

    ```bash
    cp config.example.env .env
    ```

4.  **Vul het `.env` bestand in**

    Open het `.env` bestand met een tekst-editor en vul de gegevens van je media server in.

    *Voorbeeld voor Plex:*
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

## Troubleshooting

*   **Geen media zichtbaar**:
    1.  Controleer de logs met `pm2 logs posterrama`.
    2.  Ga naar het Admin Paneel en gebruik de "Test Verbinding" knop om te controleren of de servergegevens correct zijn.
    3.  Zorg ervoor dat je ten minste één film- of seriebibliotheek hebt geselecteerd.
*   **Fouten na wijzigingen**:
    1.  Schakel "Enable Debug Mode" in via het Admin Paneel voor meer gedetailleerde logs.
    2.  Herstart de applicatie via de knop in het Admin Paneel of via de command line: `pm2 restart posterrama`.

## License

Dit project is gelicenseerd onder de AGPL-3.0-or-later licentie. Zie het `LICENSE` bestand voor meer details.
