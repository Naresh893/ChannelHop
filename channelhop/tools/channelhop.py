#!/usr/bin/env python3
"""ChannelHop: tune an Airtel Xstream (Android TV) box to a channel number from any computer on
the same Wi-Fi, using the Android TV Remote protocol (the one Google's phone remote app uses).

  python channelhop.py pair 192.168.1.20      pair once; a PIN shows on the TV, type it here
  python channelhop.py tune 755               tune by number
  python channelhop.py tune "sun tv"          tune by name (HD preferred when both exist)
  python channelhop.py find vijay             look up channel numbers
  python channelhop.py info                   check the box answers
  python channelhop.py couch-tv               print the box_b64 value for the couch-tv patch

Pairing keys are kept in ~/.channelhop (keep them private: they let a device press buttons on
your box). Nothing is installed on the box.
"""
import argparse
import asyncio
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHANNELS = os.path.join(HERE, "..", "channels", "airtel-channels.json")
STATE = os.path.expanduser(os.environ.get("CHANNELHOP_HOME", "~/.channelhop"))
CERT, KEY, CONF = (os.path.join(STATE, n) for n in ("cert.pem", "key.pem", "config.json"))
CLIENT_NAME = "ChannelHop"


def load_conf():
    try:
        with open(CONF) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_conf(c):
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    with open(CONF, "w") as f:
        json.dump(c, f, indent=1)


def remote(host):
    try:
        from androidtvremote2 import AndroidTVRemote
    except ImportError:
        sys.exit("Install the remote library first:  pip install -r requirements.txt")
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    return AndroidTVRemote(CLIENT_NAME, CERT, KEY, host)


def host_or_exit(args):
    host = getattr(args, "host", None) or load_conf().get("host")
    if not host:
        sys.exit("No box yet. Pair first:  python channelhop.py pair <box-ip>")
    return host


# ------------------------------------------------------------------ channels

def channels():
    with open(CHANNELS, encoding="utf-8") as f:
        return json.load(f)["channels"]


def norm(s):
    # "Sun TV", "SUN HD" and "sun tv" all become "sun", so a name finds its HD twin.
    words = [w for w in re.split(r"[^a-z0-9]+", s.lower()) if w and w not in ("hd", "tv")]
    return "".join(words) or re.sub(r"[^a-z0-9]", "", s.lower())


def find(query):
    q = norm(query)
    rows = channels()
    exact = [c for c in rows if norm(c["name"]) == q]
    part = [c for c in rows if q in norm(c["name"])] if not exact else []
    hits = exact or part
    # HD first, then by number
    return sorted(hits, key=lambda c: (c["quality"] != "HD", c["number"]))


def resolve(target):
    if re.fullmatch(r"\d{1,5}", target):
        return int(target), None
    hits = find(target)
    if not hits:
        sys.exit(f'No channel matches "{target}". Try:  python channelhop.py find {target.split()[0]}')
    return hits[0]["number"], hits[0]["name"]


# ------------------------------------------------------------------ commands

async def cmd_pair(args):
    r = remote(args.host)
    await r.async_generate_cert_if_missing()
    name, mac = await r.async_get_name_and_mac()
    print(f"Found {name} ({mac}). Starting pairing...")
    await r.async_start_pairing()
    pin = input("Type the 6-character code shown on the TV: ").strip()
    await r.async_finish_pairing(pin)
    conf = load_conf()
    conf["host"] = args.host
    save_conf(conf)
    print("Paired. Try:  python channelhop.py tune 755")


async def connect(host):
    r = remote(host)
    if not (os.path.exists(CERT) and os.path.exists(KEY)):
        sys.exit("No pairing keys. Pair first:  python channelhop.py pair <box-ip>")
    try:
        await asyncio.wait_for(r.async_connect(), 10)
    except asyncio.TimeoutError:
        sys.exit(f"The box at {host} did not answer. Is it on, and on the same Wi-Fi?")
    await asyncio.sleep(1.5)   # let the box finish its hello
    return r


async def cmd_tune(args):
    number, name = resolve(args.target)
    r = await connect(host_or_exit(args))
    try:
        digits = str(number)
        r.send_key_command("KEYCODE_WAKEUP")
        await asyncio.sleep(0.3)
        # Back to Airtel's own TV app first (out of any streaming app).
        r.send_key_command("KEYCODE_HOME")
        await asyncio.sleep(1.5)
        # Airtel's TV app opens its number box on the first number key but drops later key
        # presses; the rest of the number typed as text goes in. (Tested on a Vantiva
        # XstreamIPTV1-VT, Nov 2026.)
        r.send_key_command(f"KEYCODE_{digits[0]}")
        if len(digits) > 1:
            await asyncio.sleep(0.8)
            r.send_text(digits[1:])
        await asyncio.sleep(1.2)
        print(f"Tuned {number}" + (f"  ({name})" if name else ""))
    finally:
        r.disconnect()


async def cmd_info(args):
    r = await connect(host_or_exit(args))
    try:
        print("on:", r.is_on)
        print("app in front:", r.current_app)
        print("device:", r.device_info)
    finally:
        r.disconnect()


def cmd_find(args):
    hits = find(args.query)
    if not hits:
        print("No match.")
    for c in hits[:30]:
        print(f'{c["number"]:>5}  {c["name"]}  [{c["quality"]}, {c["genre"]}]')


def cmd_couch_tv(args):
    host = host_or_exit(args)
    from cryptography.hazmat.primitives import serialization
    with open(KEY, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    pkcs8 = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()).decode()
    with open(CERT) as f:
        cert = f.read()
    blob = base64.b64encode(json.dumps({"host": host, "cert": cert, "key": pkcs8}).encode()).decode()
    print(blob)
    print("\nSend it to the couch-tv home (keep it private):\n"
          "  adb shell am start -n app.couchtv.launcher/.MainActivity --es box_b64 <the value above>",
          file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description="Tune an Airtel Xstream box from your computer.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("pair", help="pair with the box (once)"); s.add_argument("host")
    s = sub.add_parser("tune", help="tune a channel by number or name"); s.add_argument("target"); s.add_argument("--host")
    s = sub.add_parser("find", help="search the channel list"); s.add_argument("query")
    s = sub.add_parser("info", help="check the box answers"); s.add_argument("--host")
    s = sub.add_parser("couch-tv", help="print box_b64 for the couch-tv patch"); s.add_argument("--host")
    args = p.parse_args()

    if args.cmd == "find":
        return cmd_find(args)
    if args.cmd == "couch-tv":
        return cmd_couch_tv(args)
    fn = {"pair": cmd_pair, "tune": cmd_tune, "info": cmd_info}[args.cmd]
    try:
        asyncio.run(fn(args))
    except KeyboardInterrupt:
        pass
    except Exception as e:  # connection refused, pairing refused, ...
        sys.exit(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
