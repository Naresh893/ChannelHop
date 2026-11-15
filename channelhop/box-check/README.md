# Box Check

A **read-only** Android TV app that shows what an Airtel Xstream box (or any Android TV box) allows. It changes nothing on the box. Open it and read the screen:

- box model and Android version;
- **home apps**, and whether the box has a screen for choosing another home app;
- **accessibility**: whether the settings screen exists, and whether Box Check's own do-nothing test service is listed and can be switched on;
- **developer options** and USB/ADB debugging state;
- **TV inputs**, and whether the **channel list** (TvProvider) is readable;
- which app opens a "watch channel" link;
- the **Airtel / TV / launcher apps**, with their exported screens and links (deep-link schemes) read from their manifests;
- every app that can be opened.

While it's open, the same report is served at `http://<box-ip>:8090/` on your home network, so you can read it on a computer.

## Build

JDK 17+ and the Android SDK:

```bash
./gradlew assembleRelease      # app/build/outputs/apk/release/app-release.apk
```

The release build is signed with your local debug key, which is fine for sideloading. Install it on the box with Downloader: see [../docs/install-an-app-on-the-airtel-box.md](../docs/install-an-app-on-the-airtel-box.md).

When it opens, it may ask for access to **TV channel info**. Allow it to see the channel list.

Remove it with **Settings → Apps → Box Check → Uninstall**.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
