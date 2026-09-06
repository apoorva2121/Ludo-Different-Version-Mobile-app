# Saved checkpoint — 2026-09-06 (updated)

Work paused at the user's request. Changes are saved in the workspace; no Git commit or store submission was made.

> **There is still no Git repository, and Git is not installed on this machine.** Nothing here is
> version-controlled, so there is no diff or rollback. Backups of the files changed in the latest
> session were written to the session scratchpad only, which is not durable. Installing Git and
> taking a baseline commit remains the highest-value safety step.

## Latest session (2026-09-06, second pass)

Changed:

- **Fixed the pale selected-die chip.** `.rollChip.active` in the base page paints a white chip and
  takes its text from `--ink`, which `app.css` redefines to `#eef4ff` for the dark theme — near-white
  on white, about 1.1:1 contrast. Added `.rollChip.active { color:#12233d; }` to `app.css` (about
  15.7:1). This affected every mode, not just online; the original screenshot merely happened to be
  an online one.
- **Subset the bundled Outfit font**, 110,884 -> 71,692 bytes. It is a variable font; the `wght`
  100-900 axis, `gvar` and kerning are preserved, and no character used anywhere in the shipped
  source was dropped. 416 glyphs -> 252.

Sizes after a clean rebuild:

| Artifact | Before | After |
| --- | --- | --- |
| `dist/House-of-Kiran-test.apk` (debug) | 1,562,821 | 1,538,151 |
| `app-release-unsigned.apk` | 419,225 | 402,874 |

## Saved output

- Installable, development-signed APK: `dist/House-of-Kiran-test.apk` (1,538,151 bytes).
- SHA-256: `E3EEE892888D37BE8E9BE66FC0F49A6602CDA642842056C58E8D38664F7E9562`.
- Previous APK for reference: 1,562,821 bytes, SHA-256
  `F19BE94F792AE6CF411E6CB7B9B328AEBEB3D2D365CE05FD1851D4CB3FAC5D28`.
- The latest debug APK and test companion are installed on the connected Samsung Galaxy A35 (SM-A356E, Android 16).
- Phone screenshots: `dist/qa/device/home.png`, `local-game.png`, `online-game.png`.
- Release APK builds successfully but is unsigned: `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

## Completed

- Dark responsive UI based on the supplied `skill.json`, bundled Outfit font, player cards, prominent dice control, offline resume, sound toggle, and home navigation.
- Offline dice-handler regression fixed: leaving the online lobby no longer disables local dice/piece controls.
- Play AI, Pass & Play, Watch AI, and online lobby remain available.
- Corrected online dice selection, roster updates, command correlation, reconnect and stale navigation/request handling.
- Fixed tutorial welcome-card skip crash, tutorial overwriting a real saved match, and null-piece saved data breaking app initialization.
- Android asset sync, debug/release builds, safe-area handling, local asset loading and encrypted session storage.
- CMD launch/build helpers and setup documentation saved.
- Three subagents completed online reliability work, offline regression coverage, and documentation; all are closed.

## Verified on the final saved code

- `npm test`: **86 passed, 0 failed, 0 skipped**.
- `npm run check`: passed, including inline game JavaScript.
- Android `assembleDebug assembleRelease assembleDebugAndroidTest lintDebug`: successful; lint has **0 errors, 5 warnings**.
- Actual-device instrumentation: **2 tests passed**. Covered offline rolls/piece movement, resume, tutorial skip, background/resume preserving the save, AI turn, and online account creation/room join/server-confirmed roll via USB.
- The phone's online test used an ephemeral in-memory local server, not the existing database in `data/`. That server has been stopped; test accounts/rooms disappeared with it.
- APK signature verified (v2); packaged HTML, client scripts, CSS and Outfit font hashes match the root source files.

The initial connected Gradle test failed while the phone was locked. Later direct ADB instrumentation on the unlocked phone passed; the older Gradle HTML report still shows that earlier failure. The final successful runner output was `OK (2 tests)` in 9.019 seconds.

## Remaining — not Google Play ready

1. Upgrade compile/target SDK from 35 to 36 with compatible build tooling and rerun device/release checks. Google currently requires API 36 for new phone-app submissions: https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
2. Set up owner-controlled release/upload signing and produce the signed `.aab`; no production key has been generated.
3. Choose/deploy a public HTTPS/WSS backend if online multiplayer is to ship. Default backend remains blank; local USB connectivity is not public deployment.
4. Add/review privacy policy, Data Safety disclosures, account-deletion flows (in-app and web), content rating, store listing/artwork, and applicable Play Console testing requirements. Account creation is implemented; account deletion is not. References: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en and https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
5. Broader device, orientation, accessibility, native Back, real network interruption and long-session testing. The actual-device tests are focused smoke/regression checks, not proof every feature/device works.
6. ~~Finish visual QA: selected pending-die text appears too pale on a white chip.~~ **Done
   2026-09-06.** Root cause was the `--ink` token being redefined by the dark theme; fixed in
   `app.css` and confirmed in the settled state on a OnePlus CPH2467.
7. ~~Update README and Android README verification sections; `ARCHITECTURE_AUDIT.md` describes the
   original prototype.~~ **Done 2026-09-06.** Both READMEs now state what was and was not verified,
   and `ARCHITECTURE_AUDIT.md` is marked historical with a "What changed since this audit" section
   that lists both resolved and still-open findings.

## Known issues found during the audit, not yet fixed

- **Rate limiting breaks behind a proxy.** `server/rate-limit.js` keys on
  `request.socket.remoteAddress`. Every managed host terminates TLS at a proxy, so all players would
  share a single 120-requests-per-minute bucket. This must be fixed before any public deployment.
- **Unbounded storage growth.** `games`, `players` and `commands` rows are never expired.
- **No account deletion**, which Google Play requires for apps that support account creation.
- **`build-android.cmd` ends with `if errorlevel 1 pause`**, which hangs forever in a
  non-interactive shell. Call `scripts\build-android.ps1` directly from automation.
- **Instrumentation summary is misleading.** `onlineAccountRoomAndRollOverUsb` self-skips through
  `AssumptionViolatedException` when no server is configured, but JUnit still prints `OK (2 tests)`.
  Read the per-test status codes: `0` passed, `-4` skipped.

The supplied design's timer ring and physically simulated dice/120fps performance are not implemented or verified. Existing custom house rules were preserved.

## Resume notes

- JDK: `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`.
- SDK: `.android-sdk` in this workspace.
- Working Gradle executable: `%TEMP%\house-of-kiran-gradle-cache\gradle-8.7\bin\gradle.bat`; project cache `%TEMP%\house-of-kiran-project-cache`. These avoid OneDrive cache snapshot errors.
- Use `build-android.cmd` from CMD to rebuild the debug APK. Do not distribute a stale `dist` APK after a failed build.
- Device serial: `RZCX50XCLZB`. Keep the phone unlocked for instrumentation.
- A task-created USB reverse mapping for `tcp:8081` may remain; the temporary server is stopped. Remove the mapping with `.android-sdk\platform-tools\adb.exe -s RZCX50XCLZB reverse --remove tcp:8081` when resuming cleanup.
- Do not erase or replace the user's existing `data/` directory.
