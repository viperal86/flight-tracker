# ✈️ Flight Price Tracker — Setup Guide

## What this does
- Checks flight prices every hour automatically
- Sends you **push notifications** (Pushover), **email** (Resend), and **SMS** (Twilio) when prices drop
- Works as an iPhone web app you can add to your home screen

---

## Step 1 — Deploy to Railway (free, 5 minutes)

1. Go to **https://railway.app** and sign up with GitHub (free)
2. Click **"New Project" → "Deploy from GitHub repo"**
3. Upload this folder to a new GitHub repo first:
   - Go to **github.com**, click **+** → **New repository** → name it `flight-tracker`
   - Upload all these files
4. Railway will detect it and deploy automatically

---

## Step 2 — Set Environment Variables on Railway

In your Railway project → **Variables** tab, add these:

```
RAPIDAPI_KEY       = c70028c697msh80e55ab3c71f162p1fcb9ajsne7a3f2bb0bdc
PORT               = 3000
```

Then add notification credentials as you set them up below.

---

## Step 3 — Pushover (iPhone push notifications) ⭐ Most important

1. Download **Pushover** app on your iPhone — https://pushover.net ($4.99 one-time)
2. Sign up at **https://pushover.net**
3. Copy your **User Key** from the dashboard
4. Create a new **Application** → copy the **API Token**
5. Add to Railway variables:
   ```
   PUSHOVER_TOKEN = your_app_token
   PUSHOVER_USER  = your_user_key
   ```

---

## Step 4 — Resend (email alerts, free)

1. Sign up at **https://resend.com** (free — 3,000 emails/month)
2. Go to **API Keys** → create a key
3. Add a sending domain OR use their test domain
4. Add to Railway variables:
   ```
   RESEND_API_KEY    = re_your_key
   ALERT_EMAIL_TO    = your@email.com
   ALERT_EMAIL_FROM  = alerts@yourdomain.com
   ```

---

## Step 5 — Twilio (SMS, free trial)

1. Sign up at **https://twilio.com** (free $15 trial credit)
2. Get your **Account SID** and **Auth Token** from the dashboard
3. Get a free phone number from Twilio
4. Add to Railway variables:
   ```
   TWILIO_SID   = ACxxxxxxx
   TWILIO_AUTH  = your_auth_token
   TWILIO_FROM  = +1xxxxxxxxxx   (your Twilio number)
   ALERT_PHONE  = +1xxxxxxxxxx   (YOUR phone number)
   ```

---

## Step 6 — Add to iPhone Home Screen

1. Open Safari on your iPhone
2. Go to your Railway app URL (e.g. `https://flight-tracker-xxx.up.railway.app`)
3. Tap the **Share** button → **"Add to Home Screen"**
4. Name it "Flight Tracker" → tap **Add**

You now have a native-feeling flight tracker app on your iPhone! 📱

---

## How alerts work

- Prices are checked **every hour** automatically
- You get notified when:
  - Price drops **below your target**, OR
  - Price drops **more than 3%** from when you set the alert
- After an alert fires, it **snoozes for 6 hours** to avoid spam
- All alerts survive server restarts (saved to disk)

---

## Troubleshooting

- **No flights found**: Make sure you select airports from the dropdown (don't just type)
- **No notifications**: Check your Railway variables are set correctly, visit `/health` to confirm server is running
- **Railway free tier**: Sleeps after 30 mins of inactivity — upgrade to Hobby ($5/mo) for 24/7 uptime
