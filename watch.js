// The shared watcher for Neuschwanstein Castle Ticket Alerts. It asks the site which dates people
// are waiting for, opens the official Hohenschwangau ticket shop like a normal visitor, asks the shop
// (with the same request its own page makes when you pick a day) which tours still have free places
// on each date, for Neuschwanstein and Hohenschwangau, and reports back. The site decides who to email.
const { chromium } = require('playwright');

const SHOP = 'https://shop.ticket-center-hohenschwangau.de/?lang=en';
const UPDATE = '/Shop/PerformResUpdate2/de-DE/39901/';
// Castle code -> the shop's pool and ticket type (single castle tickets).
const CASTLES = { N: { pool: '30', type: '44' }, H: { pool: '24', type: '41' } };
const LANGS = { 'Deutsch': 'de', 'English (UK)': 'en', 'Audio Guide': 'audio' };
const RUN_MINUTES = Number(process.env.RUN_MINUTES || 0);   // 0 = check once
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS || 180);
const { HTTPS_PROXY, WATCHER_TOKEN } = process.env;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function site(path, body) {
  const r = await fetch(SITE_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${WATCHER_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`site ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Epoch ms of a local Bavarian time 'YYYY-MM-DD' + 'HH:MM'.
function berlinMs(iso, hm) {
  for (const off of ['+01:00', '+02:00']) {
    const ms = Date.parse(`${iso}T${hm}:00${off}`);
    if (new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).startsWith(`${iso} ${hm}`)) return ms;
  }
  return Date.parse(`${iso}T${hm}:00+01:00`);
}

// The shop's answer for one castle and day -> tours with free places. Sold-out tours are not listed.
// Stable id: castle digit, date, time, language digit (fits a JS number).
function parseTours(html, castle, iso) {
  const flat = html.replace(/\s+/g, ' ');
  const shown = (flat.match(/id="dtSelectedDate" value="([\d.]+)"|value="([\d.]+)" name="dtSelectedDate"/) || []).slice(1).find(Boolean);
  if (shown && shown !== iso.split('-').reverse().join('.')) return null;   // shop answered another day (past date)
  const out = [];
  for (const m of flat.matchAll(/type="radio" value="\d+_(\d+)"[\s\S]*?<span class="time">(\d\d:\d\d)<\/span>([\s\S]*?)<\/label>/g)) {
    const text = m[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const lang = LANGS[text] || 'other';
    const li = ['de', 'en', 'audio', 'other'].indexOf(lang);
    out.push({
      id: Number(`${castle === 'N' ? 1 : 2}${iso.replace(/-/g, '')}${m[2].replace(':', '')}${li}`),
      castle, lang, startDate: new Date(berlinMs(iso, m[2])).toISOString(),
      status: 'available', availableTickets: Number(m[1]),
    });
  }
  return out;
}

async function checkDates(page, dates) {
  await page.goto(SHOP, { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByText('Schloss Neuschwanstein').first().click();
  await page.waitForTimeout(2000);
  const out = {};
  let errors = 0;
  for (const iso of dates) {
    const events = [];
    try {
      for (const [castle, c] of Object.entries(CASTLES)) {
        const d = iso.split('-').reverse().join('.');
        const body = { dtStartDate: d, dtSelectedDate: d, nPoolNr: c.pool, nTicketTypeNr: c.type, bReservation: 'true', PersonSelection: [], SelectedSubContigents: [], nPlaces: 1, nDays: 0 };
        const res = await page.evaluate(async ([u, b]) => {
          const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify(b) });
          return r.ok ? r.json() : { error: r.status };
        }, [UPDATE, body]);
        if (!res || res.error || typeof res.szContent !== 'string') throw new Error(`shop answered ${res && res.error}`);
        const tours = parseTours(res.szContent, castle, iso);
        if (!tours) throw new Error('shop showed another day');
        events.push(...tours);
        await sleep(400);   // be gentle: about the pace of a person clicking
      }
      out[iso] = { events, ...(events.length ? {} : { note: 'sold out' }) };
    } catch (err) { errors++; console.log(iso, 'skipped:', err.message); }
  }
  if (dates.length && errors === dates.length) throw new Error('every date failed to load');
  return out;
}

async function checkOnce(browser, dates) {
  const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  let timer;
  const stuck = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('check took over 5 minutes, giving up on this round')), 5 * 60000); });
  try { return await Promise.race([stuck, checkDates(page, dates)]); }
  finally { clearTimeout(timer); await Promise.race([ctx.close(), sleep(10000)]).catch(() => {}); }
}

async function main() {
  if (!SITE_URL || !WATCHER_TOKEN) throw new Error('SITE_URL and WATCHER_TOKEN must be set');
  setTimeout(() => { console.log('watchdog: run went past its time, exiting'); process.exit(0); }, (RUN_MINUTES + 4) * 60000).unref();
  const browser = await chromium.launch({
    ...(HTTPS_PROXY ? { proxy: { server: HTTPS_PROXY } } : {}),
    args: HTTPS_PROXY ? ['--ignore-certificate-errors'] : [],
  });
  const end = Date.now() + RUN_MINUTES * 60000;
  let ok = 0, failed = 0;
  try {
    do {
      try {
        let dates;
        try { ({ dates } = await site('/api/watcher/watchlist')); }
        catch (err) { console.log(new Date().toISOString(), 'site not reachable (not deployed yet?):', err.message); dates = null; }
        if (dates) {
          const result = dates.length ? await checkOnce(browser, dates) : {};
          if (!dates.length) console.log(new Date().toISOString(), 'nobody is waiting for a date right now');
          for (const [iso, r] of Object.entries(result)) console.log(new Date().toISOString(), iso, r.note || r.events.map(e => `${e.castle} ${e.startDate.slice(11, 16)}Z ${e.lang} ${e.availableTickets}`).join(' | '));
          let r = await site('/api/watcher/report', { results: result });
          console.log(`site: ${r.opened} tour(s) opened, ${r.queued} alert email(s) queued, ${r.sent} sent, ${r.remaining} waiting`);
          for (let i = 0; i < 20 && r.remaining > 0 && r.sent > 0; i++) r = await site('/api/watcher/flush', {});
          ok++;
        }
      } catch (err) { failed++; console.log(new Date().toISOString(), 'check failed:', err.message); }
      if (Date.now() + INTERVAL_SECONDS * 1000 > end) break;
      await sleep(INTERVAL_SECONDS * 1000);
    } while (true);
  } finally { await Promise.race([browser.close(), sleep(15000)]).catch(() => {}); }
  if (!ok && failed) process.exit(1);
}

if (require.main === module) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
module.exports = { parseTours, checkDates };
