const test = require('node:test');
const assert = require('node:assert');
const { parseTours } = require('../watch.js');

const row = (v, t, lang) => `<input data-ax-required="1" id="x" type="radio" value="${v}" /><label class="small cb"></label></div><div><label class="txt txt-sm"><span class="time">${t}</span> <span class="heatMap"></span> <div class="visible-xs-block"></div>${lang}</label>`;
const page = d => `<input type="hidden" value="${d}" name="dtSelectedDate" id="dtSelectedDate" />`;

test('reads free places, time and language per tour', () => {
  const html = page('30.11.2026') + row('27_10', '10:10', '<span>Deutsch</span>') + row('33_1', '10:40', '<small style="color:gray">Audio Guide</small>') + row('9_4', '13:05', '<span>English (UK)</span>');
  const t = parseTours(html, 'N', '2026-11-30');
  assert.deepStrictEqual(t.map(e => [e.id, e.lang, e.availableTickets, e.startDate]), [
    [12026113010100, 'de', 10, '2026-11-30T09:10:00.000Z'],
    [12026113010402, 'audio', 1, '2026-11-30T09:40:00.000Z'],
    [12026113013051, 'en', 4, '2026-11-30T12:05:00.000Z'],
  ]);
});

test('summer time and Hohenschwangau ids', () => {
  const t = parseTours(page('01.07.2027') + row('1_45', '09:00', '<span>Deutsch</span>'), 'H', '2027-07-01');
  assert.deepStrictEqual([t[0].id, t[0].startDate], [22027070109000, '2027-07-01T07:00:00.000Z']);
});

test('sold-out day has no tours; a different day shown means no answer', () => {
  assert.deepStrictEqual(parseTours(page('05.12.2026') + 'ausverkauft', 'N', '2026-12-05'), []);
  assert.strictEqual(parseTours(page('27.11.2026') + row('72_5', '10:00', 'Deutsch'), 'N', '2026-11-26'), null);
});
