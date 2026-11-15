# ChannelHop for couch-tv

[couch-tv](https://github.com/Seagey/couch-tv) is a simple home screen for Google TV / Android TV. This patch adds Airtel channels to it, so a Google TV (here a Haier) with an Airtel Xstream box on one of its HDMI inputs gets:

- a **Channels row** above the apps: big tiles with logos, an **HD** badge on HD channels, and recent channels first;
- an **All channels** tile (in the row and inside **All apps**) that opens a 6-per-row picker of all 396 Airtel channels, with a **Tamil** tab;
- one press to switch to the box's HDMI input and tune the channel.

The patch also brings these home-screen changes, made for older viewers:
- the apps row at the bottom, six bigger tiles per row, and an **All apps** tile;
- an optional Airtel-colours look;
- the **Home** button goes straight to couch-tv on Haier TVs;
- on power-on, the last channel or app opens again (can be switched off);
- a screensaver choice;
- optional **Lights**: on/off, brightness and colour for a bulb behind your own small web API (`/api/login`, `/api/power`, `/api/white`, `/api/colour`, `/api/state`). Leave it unset if you don't have one.

The patch applies on couch-tv commit **`fd568c0`**.

## Apply

```bash
git clone https://github.com/Seagey/couch-tv.git
cd couch-tv
git checkout fd568c0
git apply ../channelhop/couch-tv/channelhop-couch-tv.patch
```

Then build and install couch-tv as its own README describes.

## Connect it to your Airtel box

1. Pair from a computer once, with `tools/channelhop.py pair <box-ip>` (see the main README).
2. Print the key bundle and send it to the TV (from the couch-tv folder):
   ```bash
   BOX=$(python ../channelhop/tools/channelhop.py couch-tv)
   TV_IP=<tv-ip> .venv/bin/python tv-home/tools/tvadb.py shell "am start -n app.couchtv.launcher/.MainActivity --es box_b64 $BOX"
   ```
   It's kept only in couch-tv's private settings on the TV. Send `--es box_b64 none` to remove it.

The full walk-through, from building to the settings on the TV, is in [../docs/SETUP.md](../docs/SETUP.md), Part 2.

## Choose your channels (config.json → `home`)

```json
"home": {
  "channels": [
    { "number": "755", "name": "Sun TV HD", "image": "https://…/sun.png" },
    { "number": "757", "name": "KTV HD" },
    { "number": "759", "name": "Star Vijay HD" }
  ],
  "channel_input": "com.mediatek.tvinput/.hdmi.HDMIInputService/HW5",
  "airtel_theme": false
}
```

- **`channels`**: up to 8 favourites. `image` is an `https://` link or `logos/<name>.png`. If you use `logos/`, put the files in `tv-home/web/logos/` yourself; channel logos aren't included because they belong to the channels. Look up numbers with `channelhop.py find <name>`.
- **`channel_input`**: the TV input the Airtel box is on. On this Haier, HDMI 1 is `…/HW5`. To list your TV's inputs, run `TV_IP=<tv-ip> .venv/bin/python tv-home/tools/tvadb.py shell "dumpsys tv_input"` and look at the input ids.
- **`airtel_theme`**: start in Airtel colours. It can also be toggled in the TV's settings.

## Lights (optional)

Set up the bulb service first ([../lights-service/](../lights-service/), [../docs/SETUP.md](../docs/SETUP.md) Part 3). Then:

```bash
LIGHTS_URL=https://your-bulb-api.example TV_IP=<tv-ip> python tv-home/tools/lights-signin.py
```

On a Mac this asks for the password in a hidden dialog. The password is checked against `/api/login` first. Then the address and password are kept in couch-tv's private settings on the TV, so it can sign in again when its token runs out. Use a password only for this bulb service, and `--forget` removes it from the TV.

## Licence

couch-tv is MIT, © 2026 Seagey; its licence is in [LICENSE-couch-tv](LICENSE-couch-tv) and must stay with the patch. This patch is MIT, © 2026 Naresh S S.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
