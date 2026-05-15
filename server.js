const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');

const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ─── CONFIG (set these as environment variables on Railway) ───────────────────
const CONFIG = {
  RAPIDAPI_KEY:       process.env.RAPIDAPI_KEY       || '',
  PUSHOVER_TOKEN:     process.env.PUSHOVER_TOKEN      || '',  // Pushover app token
  PUSHOVER_USER:      process.env.PUSHOVER_USER       || '',  // Pushover user key
  RESEND_API_KEY:     process.env.RESEND_API_KEY      || '',  // Resend.com API key
  ALERT_EMAIL_TO:     process.env.ALERT_EMAIL_TO      || '',  // Your email address
  ALERT_EMAIL_FROM:   process.env.ALERT_EMAIL_FROM    || 'alerts@yourdomain.com',
  TWILIO_SID:         process.env.TWILIO_SID          || '',
  TWILIO_AUTH:        process.env.TWILIO_AUTH         || '',
  TWILIO_FROM:        process.env.TWILIO_FROM         || '',  // Your Twilio number
  ALERT_PHONE:        process.env.ALERT_PHONE         || '',  // Your phone e.g. +14045550123
  PORT:               process.env.PORT                || 3000,
};

const API_HOST = 'sky-scrapper.p.rapidapi.com';
const HEADERS  = { 'X-RapidAPI-Key': CONFIG.RAPIDAPI_KEY, 'X-RapidAPI-Host': API_HOST };

// ─── STORAGE (file-based, persists across restarts via Railway volume) ────────
const DB_PATH = path.join(__dirname, 'data', 'alerts.json');
function loadAlerts() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch { return []; }
}
function saveAlerts(alerts) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(alerts, null, 2));
}

// ─── FLIGHT SEARCH ────────────────────────────────────────────────────────────
async function searchAirport(query) {
  const res = await fetch(
    `https://${API_HOST}/api/v1/flights/searchAirport?query=${encodeURIComponent(query)}&locale=en-US`,
    { headers: HEADERS }
  );
  const json = await res.json();
  return (json.data || [])[0] || null;
}

async function searchFlightsWithPolling(params, maxAttempts = 6) {
  const urlParams = new URLSearchParams({
    ...params, currency: 'USD', market: 'en-US', countryCode: 'US'
  });
  let lastJson = null;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://${API_HOST}/api/v2/flights/searchFlights?${urlParams}`, { headers: HEADERS });
    const json = await res.json();
    lastJson = json;
    // Handle both response shapes: {data:{itineraries:[]}} and {itineraries:[]}
    const data = json?.data || json || {};
    const itineraries = data.itineraries || [];
    const status = data.context?.status || json?.context?.status;
    console.log(`Poll ${i+1}: status=${status}, results=${itineraries.length}, keys=${Object.keys(data).join(',')}`);
    if (itineraries.length > 0) return json;
    if (status === 'complete') return json;
    await new Promise(r => setTimeout(r, 2500));
  }
  return lastJson;
}

async function getLowestPrice({ originSkyId, destinationSkyId, originEntityId, destinationEntityId, date, adults = 1, cabinClass = 'economy', returnDate }) {
  const json = await searchFlightsWithPolling({
    originSkyId, destinationSkyId, originEntityId, destinationEntityId,
    date, adults, cabinClass, ...(returnDate && { returnDate })
  });
  const itineraries = json?.data?.itineraries || [];
  if (!itineraries.length) return null;
  const prices = itineraries.map(i => i.price?.raw || 0).filter(p => p > 0);
  return prices.length ? Math.min(...prices) : null;
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function sendPushover(title, message) {
  if (!CONFIG.PUSHOVER_TOKEN || !CONFIG.PUSHOVER_USER) return;
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: CONFIG.PUSHOVER_TOKEN,
        user:  CONFIG.PUSHOVER_USER,
        title, message, sound: 'cashregister', priority: 1,
      }),
    });
    console.log('✅ Pushover sent');
  } catch (e) { console.error('Pushover error:', e.message); }
}

async function sendEmail(subject, html) {
  if (!CONFIG.RESEND_API_KEY || !CONFIG.ALERT_EMAIL_TO) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: CONFIG.ALERT_EMAIL_FROM,
        to:   [CONFIG.ALERT_EMAIL_TO],
        subject, html,
      }),
    });
    console.log('✅ Email sent');
  } catch (e) { console.error('Email error:', e.message); }
}

async function sendSMS(body) {
  if (!CONFIG.TWILIO_SID || !CONFIG.TWILIO_AUTH || !CONFIG.ALERT_PHONE) return;
  try {
    const client = twilio(CONFIG.TWILIO_SID, CONFIG.TWILIO_AUTH);
    await client.messages.create({ body, from: CONFIG.TWILIO_FROM, to: CONFIG.ALERT_PHONE });
    console.log('✅ SMS sent');
  } catch (e) { console.error('SMS error:', e.message); }
}

async function fireAlert(alert, currentPrice) {
  const drop = Math.round(alert.lastPrice - currentPrice);
  const title = `✈️ Price drop! ${alert.route}`;
  const message = `${alert.airline || 'Flight'} dropped to $${Math.round(currentPrice)} (down $${drop} from $${Math.round(alert.lastPrice)}). Your target: $${alert.targetPrice}.`;
  const emailHtml = `
    <h2 style="color:#16a34a">✈️ Flight price drop alert!</h2>
    <p><strong>Route:</strong> ${alert.route}</p>
    <p><strong>Date:</strong> ${alert.departDate}</p>
    <p><strong>New price:</strong> <span style="color:#16a34a;font-size:1.4em;font-weight:bold">$${Math.round(currentPrice)}</span></p>
    <p><strong>Previous price:</strong> $${Math.round(alert.lastPrice)} (saved $${drop}!)</p>
    <p><strong>Your target:</strong> $${alert.targetPrice}</p>
    <p style="margin-top:16px"><a href="https://www.skyscanner.com/transport/flights/${alert.originSkyId}/${alert.destinationSkyId}/${alert.departDate.replace(/-/g,'')}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Book now on Skyscanner →</a></p>
  `;
  await Promise.all([
    sendPushover(title, message),
    sendEmail(`✈️ Price drop: ${alert.route} now $${Math.round(currentPrice)}`, emailHtml),
    sendSMS(`${title}\n${message}`),
  ]);
}

// ─── PRICE CHECK JOB (runs every hour) ───────────────────────────────────────
async function checkAllAlerts() {
  const alerts = loadAlerts();
  const active  = alerts.filter(a => a.active);
  console.log(`\n🕐 Checking ${active.length} active alerts...`);

  for (const alert of active) {
    try {
      const price = await getLowestPrice({
        originSkyId:        alert.originSkyId,
        destinationSkyId:   alert.destinationSkyId,
        originEntityId:     alert.originEntityId,
        destinationEntityId:alert.destinationEntityId,
        date:               alert.departDate,
        adults:             alert.adults || 1,
        cabinClass:         alert.cabinClass || 'economy',
        returnDate:         alert.returnDate,
      });

      if (price === null) { console.log(`  ⚠️  No results for ${alert.route}`); continue; }

      console.log(`  ${alert.route}: $${Math.round(price)} (target $${alert.targetPrice})`);

      // Update price history
      alert.priceHistory = alert.priceHistory || [];
      alert.priceHistory.push({ price, checkedAt: new Date().toISOString() });
      if (alert.priceHistory.length > 72) alert.priceHistory = alert.priceHistory.slice(-72); // keep 3 days

      const dropped = price < alert.lastPrice;
      const belowTarget = price <= alert.targetPrice;

      if (belowTarget || (dropped && price < alert.lastPrice * 0.97)) {
        await fireAlert(alert, price);
        alert.lastTriggered = new Date().toISOString();
        alert.triggeredCount = (alert.triggeredCount || 0) + 1;
        // Snooze for 6h after trigger to avoid spam
        alert.snoozedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      }

      alert.lastPrice    = price;
      alert.lastChecked  = new Date().toISOString();
    } catch (e) {
      console.error(`  ❌ Error checking ${alert.route}:`, e.message);
    }
    // Be nice to the API — wait 2s between calls
    await new Promise(r => setTimeout(r, 2000));
  }

  saveAlerts(alerts);
}

// Run every hour at :05
cron.schedule('5 * * * *', checkAllAlerts);

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Get all alerts
app.get('/api/alerts', (req, res) => {
  res.json(loadAlerts());
});

// Create alert
app.post('/api/alerts', async (req, res) => {
  const { route, originSkyId, destinationSkyId, originEntityId, destinationEntityId,
          departDate, returnDate, targetPrice, adults, cabinClass, airline } = req.body;

  if (!originSkyId || !destinationSkyId || !departDate || !targetPrice) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Fetch current price immediately
  let currentPrice = null;
  try {
    currentPrice = await getLowestPrice({ originSkyId, destinationSkyId, originEntityId, destinationEntityId, date: departDate, adults, cabinClass, returnDate });
  } catch(e) {}

  const alert = {
    id:                  Date.now().toString(),
    route, originSkyId, destinationSkyId, originEntityId, destinationEntityId,
    departDate, returnDate, targetPrice: parseFloat(targetPrice),
    adults:              adults || 1,
    cabinClass:          cabinClass || 'economy',
    airline:             airline || '',
    lastPrice:           currentPrice || parseFloat(targetPrice) * 1.1,
    currentPrice,
    priceHistory:        currentPrice ? [{ price: currentPrice, checkedAt: new Date().toISOString() }] : [],
    active:              true,
    createdAt:           new Date().toISOString(),
    lastChecked:         currentPrice ? new Date().toISOString() : null,
    triggeredCount:      0,
  };

  const alerts = loadAlerts();
  alerts.push(alert);
  saveAlerts(alerts);

  res.json({ success: true, alert });
});

// Delete alert
app.delete('/api/alerts/:id', (req, res) => {
  const alerts = loadAlerts().filter(a => a.id !== req.params.id);
  saveAlerts(alerts);
  res.json({ success: true });
});

// Toggle alert active/paused
app.patch('/api/alerts/:id', (req, res) => {
  const alerts = loadAlerts();
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  Object.assign(alert, req.body);
  saveAlerts(alerts);
  res.json({ success: true, alert });
});

// Manual price check trigger
app.post('/api/check-now', async (req, res) => {
  res.json({ success: true, message: 'Price check started' });
  checkAllAlerts().catch(console.error);
});

// Search airports proxy
app.get('/api/search-airport', async (req, res) => {
  try {
    const r = await fetch(`https://${API_HOST}/api/v1/flights/searchAirport?query=${encodeURIComponent(req.query.q)}&locale=en-US`, { headers: HEADERS });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Search flights proxy — polls until results arrive
app.get('/api/search-flights', async (req, res) => {
  try {
    const result = await searchFlightsWithPolling(req.query);
    if (!result) return res.json({ data: { itineraries: [] } });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), alertCount: loadAlerts().length }));

app.listen(CONFIG.PORT, () => console.log(`✈️  Flight tracker running on port ${CONFIG.PORT}`));

// Debug endpoint — test airport search directly
app.get('/api/debug-airport', async (req, res) => {
  const q = req.query.q || 'london';
  try {
    const url = `https://${API_HOST}/api/v1/flights/searchAirport?query=${encodeURIComponent(q)}&locale=en-US`;
    console.log('Debug airport search:', url);
    const r = await fetch(url, { headers: HEADERS });
    const text = await r.text();
    console.log('Response status:', r.status);
    console.log('Response body:', text.slice(0, 500));
    res.json({ status: r.status, url, body: JSON.parse(text) });
  } catch(e) {
    res.json({ error: e.message });
  }
});
