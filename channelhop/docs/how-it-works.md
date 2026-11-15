# How ChannelHop tunes the Airtel box

## The connection

The Airtel Xstream IPTV box is an Android TV device. Like every Android TV device with Google services, it runs the **Android TV Remote service** that Google's phone remote app uses.

- **Pairing:** port **6467**. The box shows a 6-character code on the TV and the client sends it back. The box then trusts that client's certificate.
- **Remote control:** port **6466**. A TLS connection that uses the paired client certificate. Messages are small protobufs (`RemoteMessage`). The ones used here are:

| Field | Message | Used for |
|---|---|---|
| 1 | `remote_configure` | hello: features (ping, keys, IME, power, volume, app links) |
| 2 | `remote_set_active` | hello reply |
| 8 / 9 | ping request / response | keep-alive |
| 10 | `remote_key_inject` | key presses: `KEYCODE_WAKEUP` (224), `KEYCODE_HOME` (3), `KEYCODE_0..9` (7..16), direction SHORT (3) |
| 21 | `remote_ime_batch_edit` | typed text: `{ime_counter, field_counter, edit_info: [{insert: 1, text_field_status: {start: len-1, end: len-1, value: text}}]}` |

## Why "first digit as a key, the rest as text"

These were tested on the box itself (November 2026):

- Sending `7`, `5`, `5` as three key presses tunes to **7**. Airtel's app takes the first key and opens its number box, then drops the next keys.
- The box **never sends** an IME batch edit back. So the counters stay at `0`, and a client that waits for one waits forever.
- Sending the first digit as a key, waiting about **800 ms**, then sending `"55"` as an IME batch edit with counters `0` tunes to **755**.

Pressing **Home** first makes sure Airtel's own TV app is in front. Number keys pressed inside YouTube or another app don't change the channel.

## Timings that worked

| Step | Wait after |
|---|---|
| connect | until `set_active` arrives (up to 6 s) |
| `KEYCODE_WAKEUP` | 300 ms |
| `KEYCODE_HOME` | 1500 ms |
| first digit | 800 ms |
| rest as text | 1200 ms, then disconnect |

## Same numbers as Airtel DTH

The IPTV box uses Airtel DTH's channel numbers (754 Sun TV and 755 SUN HD were checked on the box). That's why `channels/airtel-channels.json` is built from Airtel's public DTH channel list.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
