# ChannelHop: full setup, step by step

This guide goes from nothing to a TV home screen with **big channel tiles**, an **All channels** picker and a **Lights** button. Do only the parts you want:

| Part | What you get | Needs |
|---|---|---|
| **1. Pair with the Airtel box** | Tune channels from a computer | A computer on the same Wi-Fi (once) |
| **2. TV home with channels** | Channels row, All channels, big tiles, Home button fix, resume at power-on | A Google TV / Android TV with the Airtel box on one HDMI input |
| **3. Lights** | On/off, brightness and colour for a Halonix (Tuya) bulb from the TV home | The bulb, a free Tuya developer account, a free AWS account |
| **4. Box Check** (optional) | See what your Airtel box allows | Downloader on the Airtel box |

For any part, keep this to hand:

- **The Airtel box's IP address.** Find it in your router's list of connected devices, or on the box under **Settings → Network & Internet → (your Wi-Fi)**. Example: `192.168.1.20`.
- **The TV's IP address** (part 2), found the same way. Example: `192.168.1.50`.
- If you can, give both a **fixed address** in your router (often called "DHCP reservation"). Then nothing breaks when the router restarts.

---

## Part 1. Pair with the Airtel box (5 minutes)

On a computer (Mac, Windows or Linux) with **Python 3.10+**:

```bash
git clone https://github.com/<you>/channelhop.git
cd channelhop/tools
python3 -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

1. Turn on the Airtel box and the TV it's connected to.
2. Run:
   ```bash
   python channelhop.py pair 192.168.1.20
   ```
3. A **6-character code** appears on the TV. Type it in and press Enter. You'll see `Paired.`
4. Try it:
   ```bash
   python channelhop.py tune "sun tv"      # → 755 SUN HD
   python channelhop.py find vijay
   python channelhop.py tune 757
   ```

The keys are saved in `~/.channelhop/`. Keep that folder private: it can press buttons on your box.

**If it doesn't work**

| What you see | Fix |
|---|---|
| `did not answer` | The box is off or asleep, or on a different Wi-Fi, or the IP is wrong. |
| No code on the TV | The TV must be showing the Airtel box's HDMI input. Run `pair` again. |
| Only the first digit tunes (for example 7 instead of 755) | Run it again. If it keeps happening, the box was busy: wait a second between tunes. |
| It worked before, now it's refused | The box was reset or updated. Run `pair` again. |

---

## Part 2. The TV home with channels (30–60 minutes, once)

This uses [couch-tv](https://github.com/Seagey/couch-tv), a simple home screen for Google TV / Android TV, with the ChannelHop patch on top. The Google home screen stays installed and switched on; couch-tv just becomes the home you see.

### 2.1 Get couch-tv and apply the patch

```bash
git clone https://github.com/Seagey/couch-tv.git
cd couch-tv
git checkout fd568c0
git apply ../channelhop/couch-tv/channelhop-couch-tv.patch
cp config.example.json config.json
```

### 2.2 Developer mode and Python

Follow couch-tv's [docs/SETUP.md](https://github.com/Seagey/couch-tv/blob/main/docs/SETUP.md):
- **Step 1:** switch on developer mode and network debugging on the TV.
- **Step 2:** make the Python `.venv` inside couch-tv.

### 2.3 Choose your channels

Edit `config.json` and add these to the `"home"` section (keep what's already there):

```json
"channels": [
  { "number": "755", "name": "Sun TV HD" },
  { "number": "757", "name": "KTV HD" },
  { "number": "759", "name": "Star Vijay HD" },
  { "number": "752", "name": "Zee Tamil HD" }
],
"channel_input": "<the box's HDMI input id, see below>",
"airtel_theme": false
```

- **Numbers:** look them up with `python ../channelhop/tools/channelhop.py find <name>`. Up to **8** favourites. The row also puts the channels you watched recently first, and the **All channels** tile lists every channel.
- **Logos (optional):** add `"image": "https://…/logo.png"`. Or put a PNG in `tv-home/web/logos/` and use `"image": "logos/sun-tv.png"` (lower-case letters, numbers and `-` only). `channels/airtel-channels.json` has Airtel's own logo links for many channels.
- **`channel_input`:** the TV input the Airtel box is plugged into, so one press switches to it. To list your TV's inputs:
  ```bash
  TV_IP=192.168.1.50 .venv/bin/python tv-home/tools/tvadb.py shell "dumpsys tv_input | grep -i 'hdmi' | grep -i id"
  ```
  For example, HDMI 1 on a Haier TV is `com.mediatek.tvinput/.hdmi.HDMIInputService/HW5`. Other makers use different names. If you're unsure which one it is, try each.

### 2.4 Build and install

The patch changes the app, so build it yourself. The JDK 21 and Android SDK steps are in couch-tv's [docs/SETUP.md → "Building the app"](https://github.com/Seagey/couch-tv/blob/main/docs/SETUP.md#building-the-app-instead-of-downloading-it).

```bash
JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk CONFIG=config.json sh scripts/build-apk.sh
TV_IP=192.168.1.50 .venv/bin/python tv-home/tools/survey-tv.py          # look first; changes nothing
TV_IP=192.168.1.50 sh tv-home/tools/apply.sh                            # installs it and makes it the home
```

### 2.5 Give the TV the box's pairing key

This lets the TV home tune the box. It uses the keys from Part 1.

```bash
BOX=$(python ../channelhop/tools/channelhop.py couch-tv)
TV_IP=192.168.1.50 .venv/bin/python tv-home/tools/tvadb.py shell "am start -n app.couchtv.launcher/.MainActivity --es box_b64 $BOX"
```

The key is stored only in the app's private settings on the TV. To remove it, run the same command with `--es box_b64 none`.

### 2.6 Try it with the TV remote

- Press **Home**. The couch-tv home should show the **Channels** row above the apps.
- Pick a channel. The TV switches to the Airtel input and the box tunes it, in about 3 seconds.
- **All channels** (the IPTV tile, also inside **All apps**) opens every channel, 6 per row, with **Tamil** and **All** tabs.

### 2.7 Settings worth checking (in couch-tv's Home settings, on the TV)

| Setting | Suggestion |
|---|---|
| **When the TV turns on** | *Last used*: reopens the last channel or app after a power cut or power-on. |
| **Hide rows when idle** | *Off*, if the rows seem to "disappear". |
| **Airtel colours** | On or off, as you like. |
| **Screensaver** | Pick a clock or Google Photos. |
| **Navigation sound** | Off, if the clicks bother anyone. |

### 2.8 After you change `config.json`

Run `apply.sh` again (step 2.4, last line). It sends your settings to the TV. You only need to rebuild the app when the code changes.

### If the TV home misbehaves

| What you see | Fix |
|---|---|
| **Home** shows Google's home first | Run `apply.sh` again. It switches the Home button watch back on. On Haier TVs the patch catches the Home key itself. |
| A channel tile does nothing | Step 2.5 wasn't done, the box is off, or the box's IP changed. Give it a fixed IP, then redo Part 1 `pair` and step 2.5. |
| Only the first digit tunes | The box was slow to open its number box. Try again. |
| The wrong input opens | `channel_input` is wrong (step 2.3). |
| A Google TV update brought the Google home back | Run `apply.sh` again. |

---

## Part 3. Lights: a Halonix bulb on the TV home (45 minutes, once)

The TV doesn't talk to the bulb directly. It calls a **small web service of yours** (the "bulb service"), which talks to the bulb through Tuya's cloud. Halonix bulbs are Tuya bulbs. The service is in [`lights-service/`](../lights-service/) and runs free on **AWS Lambda**.

```
TV home  ──https──▶  your bulb service (AWS Lambda)  ──▶  Tuya cloud  ──▶  bulb
```

### 3.1 Put the bulb in Smart Life and get Tuya keys

1. Add the bulb to the **Smart Life** app. If it's in the Halonix app, remove it there first. Then switch the bulb off and on 3 times until it blinks quickly, and add it in Smart Life.
2. Make a free account at [platform.tuya.com](https://platform.tuya.com), and create a **Cloud Project**: *Smart Home*, with your country's data centre (India → *India Data Center*).
3. In the project, open **Devices → Link App Account**. Scan the QR code with Smart Life (Me → scan icon).
4. From the project's **Overview**, note the **Access ID** and the **Access Secret**.

### 3.2 Create the bulb service on AWS Lambda

Follow [`lights-service/AWS-LAMBDA-SETUP.md`](../lights-service/AWS-LAMBDA-SETUP.md). In short:

1. Create a **Lambda** function, `halonix-bulb`, Node.js 20+, in your nearest region.
2. Upload **`lights-service/halonix-bulb-lambda-node.zip`**, with handler `index.handler` and a 15 s timeout.
3. Add these environment variables:
   - `TUYA_ACCESS_ID`
   - `TUYA_ACCESS_SECRET`
   - **`APP_PASSWORD`**: required for the TV. Use 8+ characters, and use it for nothing else.
4. **Function URL**, auth type *NONE*. Copy the URL (`https://xxxx.lambda-url.<region>.on.aws`).
5. Open that URL in a browser and sign in. You should be able to switch the bulb on and off there. That proves the service works.

The URL plus the password control your bulb, so keep both private.

### 3.3 Connect the TV to the bulb service

From the couch-tv folder:

```bash
LIGHTS_URL=https://xxxx.lambda-url.<region>.on.aws TV_IP=192.168.1.50 .venv/bin/python tv-home/tools/lights-signin.py
```

- On a Mac, a password box opens: type the `APP_PASSWORD`. Elsewhere it asks in the terminal, and the typing isn't shown.
- It checks the password with the service first. Only if it's right does it send the URL and password to the TV, where couch-tv keeps them in its private settings to sign in again when needed.
- To remove it from the TV: add `--forget`.

### 3.4 Try it

A **Lights** button appears at the top of the TV home, next to Input. It opens:

- **On / Off**
- **Brightness** ‹ › in steps (10–100 %)
- **Colour** ‹ ›: warm white, cool white, red, orange, yellow, green, blue, purple, pink
- **Night light**: dim warm white

### What the TV sends (for anyone writing their own bulb service)

All requests are HTTPS, JSON, with `Authorization: Bearer <token>`. The TV accepts only an `https://host` address with no path.

| Request | Body | Notes |
|---|---|---|
| `POST /api/login` | `{"password": "…"}` | Reply `{"token": "…"}`. A 401 on any other call makes the TV sign in again once. |
| `POST /api/power` | `{"on": true}` / `{"on": false}` | |
| `POST /api/white` | `{"brightness": 10–100, "temp": 0–100}` | temp 0 = warm, 100 = cool |
| `POST /api/colour` | `{"h": 0–360, "s": 100, "v": 10–100}` | |
| `GET /api/state` | none | any JSON |

### If Lights misbehaves

| What you see | Fix |
|---|---|
| `refused that password` | Check `APP_PASSWORD` in the Lambda settings. |
| `gave no sign-in` | `APP_PASSWORD` isn't set on the Lambda. The TV needs one. |
| The button does nothing | Open the Function URL in a browser. If the bulb doesn't respond there either, see the troubleshooting table in `AWS-LAMBDA-SETUP.md` (Tuya trial expired, bulb offline, …). |
| The Lights button is missing | Step 3.3 wasn't done, or it was run with `--forget`. |

---

## Part 4. Box Check (optional)

Box Check is a read-only app that shows what the Airtel box allows: TV inputs, channel list, home apps and accessibility. Install it on the box with Downloader ([install-an-app-on-the-airtel-box.md](install-an-app-on-the-airtel-box.md)), then see [box-check/README.md](../box-check/README.md).

---

## Undo everything

- **TV home:** run couch-tv's `tv-home/tools/undo.sh` (couch-tv's SETUP.md → *Undo*). The Google home comes back.
- **Pairing:** delete `~/.channelhop/`. You can also clear the remote pairing on the box under Settings → Apps → *Android TV Remote Service* → Clear data.
- **Lights:** run `lights-signin.py --forget` and delete the Lambda function.
- **Box Check / Downloader on the box:** Settings → Apps → *(the app)* → Uninstall. Then switch Unknown sources off again.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
