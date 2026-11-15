# ChannelHop

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
Built on [couch-tv](https://github.com/Seagey/couch-tv) by Seagey.

**One-tap channels for the Airtel Xstream box.** Pick a channel on your TV's home screen, your phone or your computer, and the Airtel box tunes to it. You don't need the Airtel remote or have to remember the number.

ChannelHop talks to the box over your home Wi-Fi with the **Android TV Remote protocol**, the same one Google's phone remote app uses. Nothing has to be installed on the Airtel box, and nothing about the box is changed.

> Not made by or affiliated with Bharti Airtel. "Airtel" and "Xstream" are their trademarks. Tested on a **Vantiva XstreamIPTV1-VT** (Airtel Xstream IPTV), November 2026.

## What's in here

| Folder | What it is | Who it's for |
|---|---|---|
| [`tools/`](tools/) | `channelhop.py`: pair with the box once, then `tune 755` or `tune "sun tv"` | Anyone with a computer on the same Wi-Fi |
| [`couch-tv/`](couch-tv/) | A patch for [couch-tv](https://github.com/Seagey/couch-tv) (a simple TV home screen) that adds a **Channels row** with logos, recent channels and an **All channels** picker to a Google TV / Android TV | People who want big, simple channel tiles on the TV itself (great for parents) |
| [`android/BoxRemote.kt`](android/BoxRemote.kt) | A dependency-free Kotlin client (TLS + tiny protobuf) that tunes the box | Android developers building their own app |
| [`channels/airtel-channels.json`](channels/airtel-channels.json) | 396 Airtel channels: number, name, SD/HD, genre, logo link | Anyone building a channel list |
| [`box-check/`](box-check/) | **Box Check**, a read-only Android app that shows what your Airtel box allows (TV inputs, channel list, home apps, accessibility, the Airtel apps' links) | Tinkerers exploring what a box-side app could do |
| [`lights-service/`](lights-service/) | A small web service for AWS Lambda that controls a Halonix (Tuya) bulb, with its own control page. The TV home's **Lights** button uses it | Anyone who wants lights on the TV home |
| [`docs/`](docs/) | **[SETUP.md](docs/SETUP.md), the full step-by-step guide**, plus how tuning works and how to install an app on the Airtel box | Everyone |

## Setup

**Start with [docs/SETUP.md](docs/SETUP.md).** It walks through every part in order: pairing, the TV home with channels, Lights and Box Check, each with a "what to do if it doesn't work" table.

## Quick start (computer only)

You need Python 3.10+ and a computer on the same Wi-Fi as the Airtel box.

```bash
cd tools
pip install -r requirements.txt
python channelhop.py pair 192.168.1.20      # the box's IP address; a code appears on the TV, type it in
python channelhop.py tune "sun tv"           # HD is picked when both exist (here 755 SUN HD)
python channelhop.py tune 757
python channelhop.py find vijay
```

**Find the box's IP address** in your Wi-Fi router's list of connected devices, or on the box under Settings → Network & Internet → (your Wi-Fi).

The pairing keys are saved in `~/.channelhop/`. Treat them like a remote control: anyone who has them can press buttons on your box. Never commit them.

## How tuning works (the one trick)

Airtel's TV app opens its number box on the **first** number key, but drops number keys that follow it. So ChannelHop:

1. wakes the box and presses **Home** (back to Airtel's TV app, out of any streaming app);
2. sends the **first digit** as a key press;
3. after about 0.8 s, sends the **rest of the number as typed text**, which Airtel's number box accepts.

More detail is in [docs/how-it-works.md](docs/how-it-works.md).

## Limits

- The box must be on, on the same network, and paired once. If the box is reset, pair it again.
- Channel numbers come from Airtel's public list ([source](https://www.airtel.in/plans/dth/all-channel-list)). They can change, so refresh `channels/airtel-channels.json` when they do.
- Tuning presses Home first, so whatever app was open on the box is left.
- Channel logos aren't included. The JSON links to Airtel's own images, where they exist.

## Credits

- **[couch-tv](https://github.com/Seagey/couch-tv)** by **Seagey** (MIT): the TV home screen that ChannelHop's Channels row, All channels picker and Lights button are built into. Everything in `couch-tv/channelhop-couch-tv.patch` is a change to couch-tv's code, and couch-tv's licence notice is in [couch-tv/LICENSE-couch-tv](couch-tv/LICENSE-couch-tv). Please star and support couch-tv.
- **[androidtvremote2](https://github.com/tronikos/androidtvremote2)** by tronikos: pairing and the remote protocol in Python.
- **[Downloader](https://www.aftvnews.com/downloader/)** by AFTVnews: used to install apps on the Airtel box.

## Author

Naresh S S, [nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com)

MIT licensed. See [LICENSE](LICENSE).
