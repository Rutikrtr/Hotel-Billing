# Hotel Billing Android app

A small Android app (Trusted Web Activity) that opens the web app full screen, without a browser bar.
It runs on Chrome, so Bluetooth printing works exactly as in Chrome. App id: `in.techyverve.hotelbilling`.

## Building a new version

1. Raise `versionCode` (and `versionName`) in `app/build.gradle.kts` and push to `main`.
   The **Build Android app** workflow builds an unsigned APK and pushes it to the `apk-unsigned` branch.
2. Sign it with the private release key (kept outside GitHub, in `.android-signing/`):
   ```bash
   git fetch origin apk-unsigned && git show origin/apk-unsigned:hotel-billing-unsigned.apk > /tmp/unsigned.apk
   curl -sO https://repo.maven.apache.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
   javac -cp apksig-2.3.0.jar -d /tmp/signer android/signer/SignApk.java
   java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar:/tmp/signer SignApk .android-signing/hotel-billing-release.keystore hotelbilling <password> /tmp/unsigned.apk public/download/hotel-billing.apk
   ```
3. Commit `public/download/hotel-billing.apk`; staff download it from `/download/hotel-billing.apk`.

**Keep the release key safe.** Updates must be signed with the same key, and
`public/.well-known/assetlinks.json` lists its SHA-256 fingerprint so the app opens without a browser bar.
