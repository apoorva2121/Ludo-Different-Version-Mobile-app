# Android app

The Android WebView app bundles the board UI, scripts, images, and fonts and opens on the home mode selector. **Play AI**, **Pass & Play**, **Watch AI**, and the tutorial work without a server, login, or internet connection. **Play Online** opens the optional login and room lobby.

There is no public online backend deployed yet. `SERVER_BASE_URL` defaults to an empty string. An unconfigured online lobby asks for a game server address, while local play remains available. Startup and offline gameplay are confirmed on two physical phones; see [Device verification](#device-verification).

## Build from Windows CMD

All commands below are for Command Prompt (CMD), starting in the repository root. Requirements:

- JDK 17. Set `JAVA_HOME` if needed; the helper can discover Microsoft JDK 17 under `C:\Program Files\Microsoft\jdk-17*`.
- Android SDK with platform `android-36` and build-tools `36.0.0`. Set `ANDROID_HOME` to the SDK directory, or use the repository's `.android-sdk` directory, which the helper selects by default.
- The build uses Android Gradle Plugin 8.13.2 and Gradle 8.14.5. `gradle-wrapper.properties` is the single source of truth for the Gradle version; `scripts\build-android.ps1` always invokes `gradlew.bat` so the two cannot drift apart.
- Network access for any build dependencies that have not been cached. Offline gameplay does not imply that the first build can run offline.

If automatic discovery does not match your installation, set the actual paths in CMD before building. These are illustrative paths to replace with your installed locations:

```bat
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
set "ANDROID_HOME=C:\Users\apoor\OneDrive\Documents\Ludo\.android-sdk"
```

Build the debug test package:

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
build-android.cmd
```

`build-android.cmd` invokes `scripts\build-android.ps1` internally and forwards its arguments; you do not need to enter PowerShell commands. The checked-in build wrapper removes the need for a global Gradle installation. Each build copies the current root game assets into `android\app\src\main\assets\game`.

On success, the helper copies `android\app\build\outputs\apk\debug\app-debug.apk` to:

```text
C:\Users\apoor\OneDrive\Documents\Ludo\dist\House-of-Kiran-test.apk
```

Check that the build finishes successfully before using this file; an older copy may remain after a failed build. Copy the test APK to an Android 8.0+ phone, open it, and allow installation from the selected source if prompted.

## Debug test APK and release output

| Build | Output, relative to repository root | Intended use |
| --- | --- | --- |
| `build-android.cmd` | `dist\House-of-Kiran-test.apk` | Installable APK signed with a development key; application ID `com.houseofkiran.debug`. |
| `build-android.cmd -Release` | `android\app\build\outputs\apk\release\app-release-unsigned.apk` | Unsigned, minified release output; application ID `com.houseofkiran`. Requires release signing before installation or distribution. |

The release command does not update the debug test APK in `dist`. Release signing, distribution preparation, and final device verification are still required. A successful build or JavaScript test run is not a phone test result.

## Test online rooms against a Windows PC

Install Node.js 22.5+ with built-in SQLite support enabled and npm on `PATH`. Connect the PC and phone to the same reachable private network. In a CMD window, run:

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
npm install
set "HOST=0.0.0.0"
set "PORT=8080"
start-local.cmd
```

Keep that window open. The launcher creates a local signing secret and SQLite database in `data` and allows the Android bundled page origin. Allow the server's port through Windows Firewall for the private network if necessary.

In another CMD window, find the PC's private IPv4 address:

```bat
ipconfig
```

On the phone, choose **Play Online > Connection settings > Server address** and enter `http://` followed by the PC's private IPv4 address and `:8080`. For example, use `http://192.168.1.50:8080` only if `192.168.1.50` is your PC's address. `localhost` and `127.0.0.1` on the phone refer to the phone itself.

You can also prefill the same address in a debug build. Replace the illustrative address below with your PC's actual address:

```bat
cd /d C:\Users\apoor\OneDrive\Documents\Ludo
build-android.cmd -ServerUrl "http://192.168.1.50:8080"
```

`-ServerUrl` supplies the `serverBaseUrl` build property, which becomes `BuildConfig.SERVER_BASE_URL`. Supply only an HTTP(S) origin with an optional port, without a path, credentials, tokens, or private keys. Leaving this argument out keeps the build's default server address empty; the lobby may restore a previously saved room's server address.

Create an account in the lobby with a 3-40 character username and a password of at least 12 characters. Existing users enter their credentials and choose **Create room** or **Join room**, which signs them in. Create a 2-4 player room, share its code, and join from another account on the same server. The game waits for all selected seats; teams require four players. Close the lobby or choose **Play offline instead** to return home.

The debug lobby accepts HTTP only for loopback and private IPv4 servers, as well as HTTPS servers. Its native debug network configuration permits cleartext and mixed content for testing. Release builds disable cleartext and mixed content and require HTTPS/WSS for online play. A LAN server is a local test setup; public online play still needs a deployed backend with HTTPS/WSS.

## Device verification

### Verified

**Samsung Galaxy A35 (SM-A356E), Android 16, debug build — 2026-09-06.** Instrumentation run reported `OK (2 tests)` in 9.019 s, covering offline rolls and piece movement, resume, tutorial skip, background/resume preserving the save, an AI turn, and — against a temporary in-memory server reached over a USB reverse mapping — online account creation, room join and a server-confirmed roll. That server was ephemeral and has been stopped; its accounts and rooms no longer exist.

**OnePlus CPH2467, Android 15 (SDK 35), 1080x2400, debug build — 2026-09-06.** Installed and launched from `dist\House-of-Kiran-test.apk`. Home screen, language selector, banner and bundled Outfit font render correctly; Play AI setup, board rendering, dice rolling, AI turns and the roll-strip chips were exercised by hand. Instrumentation on this device: `offlineDiceMovesResumeAndOnlineSwitch` **passed**; `onlineAccountRoomAndRollOverUsb` **self-skipped** through `AssumptionViolatedException` because no server was configured. Note that JUnit still prints `OK (2 tests)` for that combination — a skip is not a pass, so check the per-test status codes (`0` passed, `-4` skipped) rather than the summary line.

An earlier Gradle connected-test HTML report still records a failure from a run made while the phone was locked. That report is kept deliberately; the later direct-ADB runs on an unlocked phone are the current result.

**OnePlus CPH2467, Android 15, debug build at targetSdk 36 — 2026-09-06.** After the SDK 36 upgrade, re-verified on device: `dumpsys` confirms `targetSdk=36`; instrumentation unchanged (offline passed, online self-skipped); the home screen renders identically to the SDK 35 build at the same scroll position, so edge-to-edge insets are unaffected; and Back from inside a game is still intercepted by `HOKApp.handleBack()`, which shows the "Back to home?" confirmation rather than exiting. Back from the home screen exits the app, which is the intended behaviour.

### Still to verify

1. Any device other than the two above, and any tablet or foldable form factor.
2. Orientation changes. The activity declares `configChanges` for orientation but rotation has not been exercised.
3. Accessibility: TalkBack, large font scales, and high-contrast modes.
4. Native Android Back behaviour across every screen, including predictive back.
5. Real network interruption and reconnection against a reachable backend, and long-session stability.
6. **The release variant.** Every device test so far used the debug build. Release sets `minifyEnabled true` and `shrinkResources true`, so R8-only breakage would not have been caught. Release cannot be installed until signing is configured.
7. Online play against a public HTTPS/WSS backend, which does not exist yet.

## Packaging and security notes

- Bundled content loads through AndroidX `WebViewAssetLoader` at `https://appassets.androidplatform.net`; this is a local asset origin, not the online backend.
- WebView navigation is restricted to bundled game pages; file and content access are disabled.
- `AndroidSession` exposes token get/store/clear to the bundled page. `SecureTokenStore` encrypts session tokens with an Android Keystore AES/GCM key.
- No server signing secrets or database credentials belong in the APK. Release builds enable code/resource shrinking and disable WebView debugging.
