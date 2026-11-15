# Bulb service (Halonix / Tuya, on AWS Lambda)

This is a small web service that controls a **Halonix** (Tuya-based) Wi-Fi bulb through **Tuya's cloud**, plus a full control page. Open the Function URL in a browser to get the colour wheel, white, scenes, schedules and more.

The ChannelHop TV home's **Lights** button calls this service.

| File | What it is |
|---|---|
| `halonix-bulb-lambda-node.zip` | Upload this to AWS Lambda (it holds `index.mjs` and `index.html`) |
| `index.mjs` | The service: `/api/login`, `/api/power`, `/api/white`, `/api/colour`, `/api/state`, and more for the page |
| `index.html` | The control page it serves at `/` |
| `AWS-LAMBDA-SETUP.md` | Click-by-click AWS setup and troubleshooting |

**For the TV, set `APP_PASSWORD`** (8+ characters). The TV signs in with it. All keys stay in Lambda's environment variables: `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET` and `APP_PASSWORD`. None are in the code.

After changing `index.mjs` or `index.html`, rebuild the zip:

```bash
cd lights-service && zip -j halonix-bulb-lambda-node.zip index.mjs index.html
```

Full steps, from Smart Life to the TV: [../docs/SETUP.md](../docs/SETUP.md), Part 3.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
