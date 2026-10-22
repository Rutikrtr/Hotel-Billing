// Android app for Hotel Billing: a Trusted Web Activity that opens the web app full screen (no browser bar)
// in Chrome, so Bluetooth printing keeps working. The web address lives in res/values/strings.xml.
plugins {
    id("com.android.application")
}

android {
    namespace = "in.techyverve.hotelbilling"
    compileSdk = 34

    defaultConfig {
        applicationId = "in.techyverve.hotelbilling"
        minSdk = 24
        targetSdk = 34
        versionCode = 4
        versionName = "1.3"
    }

    buildTypes {
        release {
            // Left unsigned here; it is signed afterwards with the private release key (see android/README.md).
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
