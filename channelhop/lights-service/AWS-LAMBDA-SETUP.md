# Put the bulb controller on AWS Lambda (Node.js)

This puts your bulb controller on the internet so it works from anywhere: phone, office,
any browser. It talks to the bulb through Tuya's cloud with your Tuya project keys. You need
just one Lambda function; no database or other AWS services.

**Use your personal AWS account**, not a work account.

## 1. Create the function

1. In the AWS Console, pick the **Asia Pacific (Mumbai) ap-south-1** region (top right).
2. Go to **Lambda → Create function → Author from scratch**: name `halonix-bulb`, runtime
   **Node.js** (the default, 20.x or newer) → **Create function**.

Already have the function? Keep it and continue.

## 2. Upload the code

1. On the **Code** tab, choose **Upload from → .zip file**, pick `halonix-bulb-lambda-node.zip`, and click **Save**.
2. Check that `index.mjs` and `index.html` sit at the top of the file list, not inside a folder.
3. Under **Runtime settings** (lower on the Code tab), the handler must be `index.handler`.

## 3. Give it more time

Under **Configuration → General configuration → Edit**, set **Timeout** to **15 sec** and click **Save**.

## 4. Add your settings

Go to **Configuration → Environment variables → Edit**:

| Key | Value | Needed? |
|---|---|---|
| `TUYA_ACCESS_ID` | Access ID / Client ID: **first** box on your Tuya project's Overview page | Yes |
| `TUYA_ACCESS_SECRET` | Access Secret / Client Secret: **second** box on the same page | Yes |
| `APP_PASSWORD` | A password for the page (8+ characters) | **Optional**: leave it out and the page opens without a password |

Extras you normally don't need: `TUYA_REGION` (default `in` = India), `DEVICE_ID` (if the
project has more than one light), `TIMEZONE` / `TZ_OFFSET` (default `Asia/Kolkata` / `+05:30`).

## 5. Turn on the web address

Go to **Configuration → Function URL → Create function URL**, set **Auth type: NONE**, and click **Save**.
Open the URL it shows, then press **Start**.

Without `APP_PASSWORD`, anyone who has this exact URL can control the bulb. The URL is long
and random, so keep it to yourself, or add a password whenever you like.

## What uses Tuya calls (the free plan has a monthly limit)

| Action | Calls |
|---|---|
| Tap a colour, white, mood, power, sleep timer | 1 each (dragging a slider sends at most about 2 a second) |
| Schedules | about 1 when you save; they run in Tuya's cloud for free after that |
| Effect your bulb runs by itself | about 2 per tap |
| Effect the page has to animate (your bulb doesn't do it) | 1 every 2 seconds, stops after 10 minutes |
| Music sync | at most 1 a second, stops after the time you pick (default 10 minutes) |

The Music tab shows roughly how many calls music sync and effects have used this month on that device.

## If something goes wrong

| The page says… | Fix |
|---|---|
| Plain "Internal Server Error" | Runtime/handler mismatch (step 2), or the files ended up in a folder |
| "needs one more setting" | `TUYA_ACCESS_ID` or `TUYA_ACCESS_SECRET` is missing or misspelled |
| "clientId is invalid" (2009) | `TUYA_ACCESS_ID` holds the wrong box. Copy the **first** box, not the Project Code |
| "Tuya rejected the request signature" (1004) | Re-copy `TUYA_ACCESS_SECRET` (32 characters, no spaces) |
| "no permission for that device" (1106) | The bulb isn't linked to the project (Devices → Link App Account) |
| "Tuya's free trial … has expired" | platform.tuya.com → Cloud → your project: extend the trial (free) |
| "Bulb offline" | The bulb is off at the wall or lost Wi-Fi |
| Effects animate only while the page is open | Your bulb can't run effects by itself; that's the fallback working |

Still stuck? Open **Settings → Copy bulb details** and paste the result to whoever is helping
you. It contains no keys or passwords.

**Updating:** upload a new zip on the Code tab. Your settings stay.

---

**Author:** Naresh S S ([nareshssalpm@gmail.com](mailto:nareshssalpm@gmail.com))  
**Credit:** the TV home screen is [couch-tv](https://github.com/Seagey/couch-tv) by **Seagey** (MIT licence). ChannelHop's TV part is a patch on top of it. Thank you, couch-tv!
