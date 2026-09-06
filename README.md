# House of Kiran

House of Kiran is a browser game with an Android WebView app that bundles the game, images, and fonts. The home screen offers:

- **Play AI**: play against computer opponents.
- **Pass & Play**: share one device with other players.
- **Watch AI**: watch computer players play.
- **Play Online**: open the account and room lobby for a configured game server.

The first three modes and the tutorial need no login or internet connection in the Android app. Play AI and Pass & Play can save an offline game for **Continue last offline game**.

There is no public online backend deployed yet. The default Android server address is empty; online rooms require a running, reachable backend.

The app has been installed and exercised on real phones: a Samsung Galaxy A35 (Android 16) and a OnePlus CPH2467 (Android 15). Offline play, resume, and AI turns work on both. See [Android setup](android/README.md#device-verification) for exactly what was and was not verified.

## Run locally from Windows CMD

Use Command Prompt (CMD) for these commands. Requires Node.js 22.5+ with built-in SQLite support enabled and npm available on `PATH`.

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
npm install
start-local.cmd
```

Open `http://localhost:8080` in your browser. Keep the CMD window open while playing; press Ctrl+C to stop the server. The launcher binds to `127.0.0.1` by default, creates a local signing secret at `data\local-signing-secret`, and uses `data\house-of-kiran.sqlite` for account and game persistence. Keep the signing secret private. No manual secret or development-auth setup is needed for normal account registration and login.

If port 8080 is occupied, use a different port in the same CMD window before starting:

```bat
set "PORT=8081"
start-local.cmd
```

Then open `http://localhost:8081`. `npm run dev` is an alternative to `start-local.cmd`; `npm start` directly starts the service and does not perform the launcher's local configuration.

## Online login and rooms

1. Start the local server and choose **Play Online**. A browser opened at localhost uses that server automatically. In Android, enter a reachable server origin under **Connection settings > Server address**, or supply it when building.
2. For a new account, enter a username of 3-40 characters (letters, numbers, `_`, `.`, or `-`, starting with a letter or number) and a password of at least 12 characters, then choose **Create account**.
3. For an existing account, enter its credentials and choose **Create room** or **Join room**; those actions sign you in automatically.
4. Create a room for 2-4 players and share its room code. Other players use their own accounts on the same server and choose **Join room**. Play begins when all selected seats are filled. Teams require four players.

Close the lobby or choose **Play offline instead** to return to local play. See [Android setup](android/README.md) for phone-to-PC LAN testing and HTTPS requirements.

## Build the Android test APK from CMD

Requires JDK 17 and an Android SDK with platform 36 and the project's required build tools. The build helper uses `ANDROID_HOME`, falling back to this repository's `.android-sdk`, and can discover a Microsoft JDK 17 installation. See [Android setup](android/README.md) for environment settings.

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
build-android.cmd
```

The CMD wrapper invokes the checked-in build helper. On success, the expected installable debug APK is:

```text
C:\Users\apoor\OneDrive\Documents\Ludo\dist\House-of-Kiran-test.apk
```

Copy that file to an Android 8.0+ phone and open it to install, allowing installation from that source if prompted. This package is signed with a development key and is intended for testing. Installation, startup and offline gameplay have been confirmed on the two phones listed above; other devices, orientations and the release variant are still unverified.

```bat
build-android.cmd -Release
```

The release command produces an unsigned release APK under `android\app\build\outputs\apk\release\`; it does not replace `dist\House-of-Kiran-test.apk`. No release signing configuration is present, so the release output must be signed before it can be installed or distributed. Public online deployment and release verification are also pending.

## Development checks

Run in a separate CMD window if the server is running:

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
npm run check
npm test
```

These check JavaScript syntax and the automated engine, account, server, client, and UI tests. They run in jsdom and do not load `app.css`, so they cannot detect visual or styling regressions; those need a browser or a phone.

## Repository map

- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html`, `app-shell.js`, `app.css`, `online-ui.js`: game UI, offline controls, and online lobby; root assets are copied into Android during a build.
- `game/`: extracted board rules, state transitions, dice, move validation, and AI selection.
- `server/`: authenticated HTTP/WebSocket service, accounts, and game persistence.
- `client/`: authoritative client adapter.
- `tests/`: automated JavaScript tests.
- `android/`: native wrapper and Android instrumentation tests; see [Android README](android/README.md).
- `ARCHITECTURE_AUDIT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `THREAT_MODEL.md`, `API.md`: architecture and security documentation.
