# Tone Matcher HD500 — Android APK

This repository can build an installable Android debug APK using Capacitor.

## Included in the first Android build

- The existing Tone Matcher HD500 interface is bundled locally in the app.
- Preset Builder, Signal Chain, parameter controls, BPM, Tap Tempo, Delay Sync, Trails, and local preset storage remain in the existing HTML app.
- The app does not need to load GitHub Pages just to open its main interface.
- Network access is still needed for online search and the Cloudflare/OpenAI analysis service.

## Build the APK with GitHub Actions

1. Open the repository's **Actions** tab.
2. Select **Build Android APK**.
3. Choose **Run workflow**.
4. When the workflow finishes successfully, open the run and download the artifact named `tone-matcher-hd500-debug-apk`.
5. Extract the ZIP and install `app-debug.apk` on an Android device. Allow installation from the source used to download the file if Android asks.

A push to `main` that changes `index.html`, the Capacitor configuration, or the Android build scripts also starts an APK build automatically.

## Build locally

Requirements: Node.js 22+, Java 21, Android Studio, and Android SDK API 36.

```bash
npm install
npm run android:add
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is generated at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with Android's debug key. It is suitable for installation and testing, not for publishing as a final Play Store release. A release build needs a private signing keystore and a protected signing configuration.

## Current limitation: YouTube audio capture on Android

The existing AI workflow captures a YouTube browser tab using the desktop browser's tab-audio sharing API. That desktop capture flow is not equivalent to Android's native playback-capture API.

The initial APK keeps the other app features available, but clearly explains that YouTube audio capture needs a native Android `AudioPlaybackCapture` integration before it can run inside the APK. Android may also refuse capture when the source app's playback-capture policy does not allow it. The user must explicitly grant the Android capture permission.

The Cloudflare Worker and OpenAI API integration can be reused after the native Android audio capture bridge is implemented and tested. The Worker source also needs to be redeployed from the latest `cloudflare-worker/index.js`, which now allows the app's `https://localhost` origin in addition to GitHub Pages.
