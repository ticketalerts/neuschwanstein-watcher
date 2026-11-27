// Fetches Bing Webmaster Tools numbers for the dashboard and posts them to the site (see site/src/bing.js).
// Runs in GitHub Actions because Bing throttles Cloudflare's shared network. Prints nothing private:
// this repository's Actions logs are public.
const SITE = process.env.SITE_URL, TOKEN = process.env.WATCHER_TOKEN;
const BASE = 'https://ssl.bing.com/webmaster/api.svc/json/';
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const { key } = await (await fetch(`${SITE}/api/watcher/bing`, { headers: auth })).json();
if (!key) { console.log('No Bing API key saved in the dashboard yet.'); process.exit(0); }
console.log(`::add-mask::${key}`);

async function call(method, siteUrl) {
  const url = `${BASE}${method}?apikey=${encodeURIComponent(key)}${siteUrl ? `&siteUrl=${encodeURIComponent(siteUrl)}` : ''}`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await r.text();
    let b; try { b = JSON.parse(text); } catch { b = {}; }
    if (r.ok && b.d) return b.d;
    const msg = b.Message || b.ErrorCode || `HTTP ${r.status}`;
    if (/throttle/i.test(String(msg)) && attempt < 3) { await new Promise(res => setTimeout(res, 20000 * attempt)); continue; }
    throw new Error(String(msg));
  }
}

let body;
try {
  const sites = await call('GetUserSites');
  const site = sites.find(s => (s.Url || '').includes('neuschwansteincastleticketalerts.com'));
  body = site
    ? { sites, traffic: await call('GetRankAndTrafficStats', site.Url), queries: await call('GetQueryStats', site.Url), pages: await call('GetPageStats', site.Url) }
    : { sites };
} catch (err) {
  body = { error: err.message };
}
const r = await fetch(`${SITE}/api/watcher/bing`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const res = await r.json().catch(() => ({}));
console.log(body.error ? `Bing call failed: ${body.error}` : `Sent Bing numbers: ${res.ok ? 'ok' : 'site reported a problem (see dashboard)'}`);
