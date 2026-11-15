# Install an app on the Airtel box (Downloader)

You only need this to put your own app on the box, for example **Box Check**. You don't need it to tune channels: ChannelHop does that from outside the box, with nothing installed on it.

Use the **Airtel remote** and the Airtel box's HDMI input.

## A. Install Downloader from the Play Store

1. Press **Home** on the Airtel remote.
2. Open **Google Play Store**.
3. Search for **Downloader**, or press the mic button and say *"Downloader by AFTVnews"*.
4. Pick **Downloader** by **AFTVnews**: the orange icon with a white **D** and a down arrow. Other apps with "downloader" in the name aren't the right one.
5. Press **Install**.

## B. Allow Downloader to install apps (Unknown sources)

1. Press **Home**, then open **Settings** (the gear).
2. Go to **Device Preferences → Security & restrictions → Unknown sources**. On some boxes the path is **Settings → Apps → Security & restrictions → Unknown sources**.
3. Switch **Downloader** on.

If Downloader isn't in the list, or its switch is greyed out, your box doesn't allow app installs.

## C. Install the app

1. On your computer, put the `.apk` in a folder and share that folder on your home Wi-Fi:
   ```bash
   cd folder-with-the-apk
   python3 -m http.server 8000
   ```
2. Find the computer's IP address. On a Mac: `ipconfig getifaddr en0`.
3. On the box, open **Downloader**, type `http://<computer-ip>:8000/<file>.apk` and press **Go**.
4. When Android asks *"Do you want to install this application?"*, press **Install**.
5. Stop the file share on the computer (Ctrl+C).

To remove the app later: **Settings → Apps → (the app) → Uninstall**.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
