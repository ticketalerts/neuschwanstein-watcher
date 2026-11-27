# Ticket watcher for Neuschwanstein Castle Ticket Alerts

Checks the official [Hohenschwangau Ticket Center shop](https://shop.ticket-center-hohenschwangau.de/) for
returned Neuschwanstein and Hohenschwangau castle tour tickets on the dates people are waiting for, and reports
what it sees to [neuschwansteincastleticketalerts.com](https://neuschwansteincastleticketalerts.com), which emails
the people waiting.

- `watch.js` opens the shop in a headless browser like a normal visitor and, for each wanted date, asks for the
  day's tours the same way the shop's own page does when you pick a day. Every 3 minutes; runs chain themselves
  (about 50 minutes each). Set the repository variable `WATCHER_PAUSED` to `true` to stop.
- `bing-fetch.mjs` passes Bing Webmaster numbers to the site's dashboard at the start of each run.

Needs the repository secret `WATCHER_TOKEN` (shared with the site) and the variable `SITE_URL`.
Independent; not affiliated with the Bavarian Palace Administration or the Ticket Center Hohenschwangau.
