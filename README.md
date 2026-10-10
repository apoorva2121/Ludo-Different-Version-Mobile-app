# Different Version Ludo Game

A Ludo board game that runs in the browser and as an Android app. Offline first:
the game, images and fonts are all bundled into the Android WebView wrapper, so
nothing needs a network.

Four ways to play, from the home screen:

- **Play AI** — against computer opponents.
- **Pass & Play** — share one device.
- **Watch AI** — let the computer play itself.
- **Play Online** — accounts and room lobby, against a game server you run.

The first three modes and the tutorial need no login and no internet. Play AI
and Pass & Play save a game you can resume with **Continue last offline game**.
Banners are available in English, Hindi and Telugu.

> **There is no public online backend.** The default Android server address is
> empty, and online rooms need a running, reachable server of your own. Forks
> are welcome to point it at theirs.

**Verified on real hardware:** Samsung Galaxy A35 (Android 16) and OnePlus
CPH2467 (Android 15). Offline play, resume and AI turns work on both. See
[Android setup](android/README.md#device-verification) for exactly what was and
was not tested.

---

## Play it in a browser

Requires **Node.js 22.5+** (the built-in SQLite support is used) and npm.

```bash
git clone https://github.com/apoorva2121/house-of-kiran.git
cd house-of-kiran
npm install
npm run dev
```

Then open <http://localhost:8080>. Press Ctrl+C to stop.

The launcher binds to `127.0.0.1`, creates a local signing secret at
`data/local-signing-secret`, and keeps accounts and games in
`data/house-of-kiran.sqlite`. **Keep that signing secret private** — it is
git-ignored. No manual secret or dev-auth setup is needed for normal
registration and login.

To use a different port:

```bash
PORT=8081 npm run dev          # Windows CMD:  set "PORT=8081" && npm run dev
```

On Windows you can also double-click `start-local.cmd`, which does the same
thing. `npm start` launches the service directly and skips the launcher's local
configuration, so prefer `npm run dev` for development.

## Online accounts and rooms

1. Start the server and choose **Play Online**. A browser at localhost uses that
   server automatically. On Android, set **Connection settings → Server
   address**, or supply it at build time.
2. **New account:** username 3–40 characters (letters, numbers, `_`, `.`, `-`,
   starting with a letter or number) and a password of at least 12 characters,
   then **Create account**.
3. **Existing account:** enter credentials and choose **Create room** or **Join
   room** — either signs you in.
4. Create a room for 2–4 players and share the room code. Play begins when every
   selected seat is filled. Teams need four players.

Close the lobby or choose **Play offline instead** to go back to local play.
[Android setup](android/README.md) covers phone-to-PC LAN testing and the HTTPS
requirements.

## Build the Android app

Requires **JDK 17** and an Android SDK with platform 36. The build helper reads
`ANDROID_HOME`, falling back to a `.android-sdk` directory in the repository
(not committed — it is a large local SDK copy).

```bash
# Windows
build-android.cmd

# macOS / Linux
cd android && ./gradlew assembleDebug
```

On success the installable debug APK is at `dist/House-of-Kiran-test.apk`
(Windows helper) or `android/app/build/outputs/apk/debug/`.

Copy it to an Android 8.0+ phone and open it to install, allowing installation
from that source if prompted. It is signed with a **development key** and is for
testing only.

```bash
build-android.cmd -Release
```

The release command produces an **unsigned** release APK under
`android/app/build/outputs/apk/release/` and does not replace the test APK.
There is no release signing configuration in this repository, so you must sign
the release output yourself before installing or distributing it.

## Development checks

```bash
npm run check      # JavaScript syntax
npm test           # engine, account, server, client and UI tests
```

These run in jsdom and **do not load `app.css`**, so they cannot catch visual or
styling regressions — those need a real browser or a phone.

## Repository map

| Path | What |
|---|---|
| `House_of_Kiran_AI_Stage3_6_PRODUCTION.html`, `app-shell.js`, `app.css`, `online-ui.js` | Game UI, offline controls, online lobby. Root assets are copied into Android at build time. |
| `game/` | Board rules, state transitions, dice, move validation, AI move selection |
| `server/` | Authenticated HTTP/WebSocket service, accounts, game persistence |
| `client/` | Authoritative client adapter |
| `tests/` | Automated JavaScript tests |
| `android/` | Native wrapper and instrumentation tests — [README](android/README.md) |
| `ARCHITECTURE.md`, `ARCHITECTURE_AUDIT.md`, `SECURITY.md`, `THREAT_MODEL.md`, `API.md` | Architecture and security documentation |

## Status

Paused 2026-09-06, part way through Google Play release preparation. Read
`PLAY_RELEASE_CHECKLIST.md` first if you are picking it up.

Decisions already taken: version 1 ships offline-only; Bluetooth play deferred.
Open question: whether to hide the **Play Online** button in release builds,
given there is no public server. The remaining blocker is external — a Google
Play developer account, plus Google's requirement of 12 testers for 14 days
before a personal account may publish.

## Licence

[MIT](LICENSE).
