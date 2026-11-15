'use strict';
// Schafkopf online – kleiner Node-Server ohne Abhängigkeiten.
// Tische leben im Speicher; Updates gehen per Server-Sent Events an die Browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./engine');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const BOTNAMES = ['Sepp', 'Resi', 'Toni', 'Vroni', 'Hias', 'Wastl', 'Burgl', 'Schorsch'];
const rooms = new Map();

// ---------- Hilfen ----------
function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 5; i++) c += A[crypto.randomInt(A.length)]; } while (rooms.has(c));
  return c;
}
const token = () => crypto.randomBytes(16).toString('hex');
const names = r => r.seats.map((s, i) => (s ? s.name : 'Platz ' + (i + 1)));
const isBot = (r, i) => { const s = r.seats[i]; return !s || s.bot || s.botControl; };
const humans = r => r.seats.filter(s => s && !s.bot);
const seatOf = (r, t) => (t ? r.seats.findIndex(s => s && s.token === t) : -1);
function gameText(o) { return o.type === 'sau' ? `Sauspiel auf die ${E.SUITNAME[o.suit]}` : o.type === 'wenz' ? 'Wenz' : `${E.SUITNAME[o.suit]}-Solo`; }

function newRoom() {
  const r = {
    code: roomCode(), seats: [null, null, null, null], host: null, money: [0, 0, 0, 0], dealer: 3,
    g: null, phase: 'lobby', msg: 'Warte auf Mitspieler …', bubbles: {}, result: null, resultId: 0,
    lastTrick: null, chat: [], clients: new Set(), timer: null, collectTimer: null,
    settings: { trainer: true, aids: true }, updated: Date.now(), games: 0,
  };
  rooms.set(r.code, r);
  return r;
}

// ---------- Spielablauf ----------
function deal(r) {
  clearTimeout(r.timer); r.timer = null;
  r.dealer = (r.dealer + 1) % 4;
  const d = E.shuffle(Object.values(E.CARD).slice());
  r.g = {
    _id: E.nextId(), voids: [0, 1, 2, 3].map(() => new Set()), hands: [0, 1, 2, 3].map(i => d.slice(i * 8, i * 8 + 8)),
    dealer: r.dealer, trick: [], tricks: [], played: new Set(), won: [0, 0, 0, 0], tw: [0, 0, 0, 0],
    bids: [], best: null, bidPos: 0, type: 'sau', suit: 'E', declarer: -1, partner: -1,
    aceRevealed: false, calledLed: false, ranAway: false, turn: (r.dealer + 1) % 4,
  };
  r.phase = 'bid'; r.bubbles = {}; r.result = null; r.lastTrick = null;
  r.msg = `${names(r)[r.dealer]} hat gegeben. ${names(r)[(r.dealer + 1) % 4]} sagt zuerst an.`;
}
const bidOrder = r => [1, 2, 3, 4].map(i => (r.g.dealer + i) % 4);
const bidTurn = r => (r.phase === 'bid' && r.g.bidPos < 4 ? bidOrder(r)[r.g.bidPos] : -1);

function validBid(r, seat, bid) {
  if (bid === null) return true;
  const cur = r.g.best ? r.g.best.rank : 0;
  const e = E.evalHand(r.g.hands[seat]);
  if (bid.type === 'sau') return cur < 1 && e.sau.callable.includes(bid.suit);
  if (bid.type === 'wenz') return cur < 2;
  if (bid.type === 'solo') return cur < 2 && E.SUITS.includes(bid.suit);
  return false;
}
function doBid(r, seat, bid) {
  const g = r.g;
  g.bids.push({ seat, bid });
  r.bubbles[seat] = bid ? gameText(bid) + (bid.type === 'sau' ? '' : '!') : 'weiter';
  if (bid) g.best = Object.assign({ seat }, bid);
  g.bidPos++;
  if (g.bidPos >= 4) finishBid(r);
}
function finishBid(r) {
  const g = r.g, n = names(r);
  if (!g.best) { r.phase = 'none'; r.msg = 'Alle sagen weiter – zammgschmissen, neu geben.'; return; }
  g.type = g.best.type; g.suit = g.best.suit; g.declarer = g.best.seat;
  if (g.type === 'sau') g.partner = g.hands.findIndex(h => h.some(c => c.id === g.suit + 'A'));
  g.initial = g.hands.map(h => h.slice());
  g.turn = (g.dealer + 1) % 4;
  r.phase = 'play'; r.bubbles = {};
  r.msg = `${n[g.declarer]} spielt ${E.gameName(g)}.`;
}
function doPlay(r, seat, c) {
  const g = r.g, n = names(r);
  const h = g.hands[seat];
  h.splice(h.findIndex(x => x.id === c.id), 1);
  if (g.type === 'sau' && !g.trick.length && !E.isTr(c, g) && c.s === g.suit) {
    g.calledLed = true;
    if (seat === g.partner && c.r !== 'A') { g.ranAway = true; g.aceRevealed = true; r.msg = `${n[seat]} läuft davon!`; }
  }
  if (g.type === 'sau' && c.id === g.suit + 'A') g.aceRevealed = true;
  if (g.trick.length) { const lc = E.cat(g.trick[0].card, g); if (E.cat(c, g) !== lc) g.voids[seat].add(lc); }
  g.trick.push({ seat, card: c }); g.played.add(c.id);
  if (g.trick.length === 4) {
    const w = E.winner(g.trick, g), p = E.trickPts(g.trick);
    r.msg = `${n[w.seat]} sticht mit ${E.cname(w.card)} – ${p} Augen.`;
    r.collectTimer = setTimeout(() => { r.collectTimer = null; collect(r); update(r); }, 1700);
  } else g.turn = (seat + 1) % 4;
}
function collect(r) {
  const g = r.g;
  const w = E.winner(g.trick, g), p = E.trickPts(g.trick);
  g.won[w.seat] += p; g.tw[w.seat]++;
  g.tricks.push({ cards: g.trick, winner: w.seat, pts: p });
  r.lastTrick = { cards: g.trick.map(x => ({ seat: x.seat, id: x.card.id })), winner: w.seat, pts: p };
  g.trick = []; g.turn = w.seat;
  if (g.hands.every(x => !x.length)) endGame(r);
}
function endGame(r) {
  const g = r.g;
  const res = E.run(g, 0, names(r), () => E.computeResult());
  for (let i = 0; i < 4; i++) r.money[i] += res.delta[i];
  r.games++;
  r.result = {
    id: ++r.resultId, P: res.P, O: res.O, ptsP: res.ptsP, ptsO: res.ptsO, win: res.win, schneider: res.schneider,
    schwarz: res.schwarz, lauf: res.lauf, laufTeam: res.laufTeam, base: res.base, tarif: res.tarif, delta: res.delta,
    type: g.type, suit: g.suit, declarer: g.declarer, partner: g.partner, gameName: E.gameName(g),
    tricks: g.tricks.map(t => ({ cards: t.cards.map(x => ({ seat: x.seat, id: x.card.id })), winner: t.winner, pts: t.pts })),
  };
  r.phase = 'end';
  r.msg = `${names(r)[g.declarer]} hat ${res.win ? 'gewonnen' : 'verloren'} (${res.ptsP} Augen).`;
}

// ---------- Bots ----------
function schedule(r) {
  if (r.timer || r.collectTimer) return;
  let seat = -1;
  if (r.phase === 'bid') seat = bidTurn(r);
  else if (r.phase === 'play' && r.g.trick.length < 4) seat = r.g.turn;
  if (seat < 0 || !isBot(r, seat)) return;
  r.timer = setTimeout(() => { r.timer = null; botMove(r, seat); }, r.phase === 'bid' ? 900 : 750);
}
function botMove(r, seat) {
  if (!isBot(r, seat)) return;
  if (r.phase === 'bid' && bidTurn(r) === seat) {
    const e = E.run(r.g, seat, names(r), () => E.evalHand(r.g.hands[seat]));
    const cur = r.g.best ? r.g.best.rank : 0;
    doBid(r, seat, e.best && e.best.rank > cur ? e.best : null);
  } else if (r.phase === 'play' && r.g.turn === seat && r.g.trick.length < 4) {
    const ch = E.run(r.g, seat, names(r), () => E.choose(seat));
    doPlay(r, seat, ch.c);
  }
  update(r);
}

// ---------- Sicht eines Sitzes ----------
function view(r, seat) {
  const g = r.g, n = names(r);
  const v = {
    code: r.code, me: seat, isHost: seat >= 0 && r.seats[seat] && r.seats[seat].token === r.host,
    seats: r.seats.map(s => s && { name: s.name, bot: !!s.bot, botControl: !!s.botControl, online: s.bot || s.conn > 0, host: s.token === r.host }),
    money: r.money, dealer: r.dealer, phase: r.phase, msg: r.msg, bubbles: r.bubbles, chat: r.chat.slice(-30),
    settings: r.settings, lastTrick: r.lastTrick, result: r.phase === 'end' ? r.result : null, games: r.games,
  };
  if (g && r.phase !== 'lobby') {
    const myTurn = r.phase === 'play' && g.turn === seat && g.trick.length < 4;
    const gameCtx = r.phase === 'bid' ? { type: 'sau' } : g;
    const x = seat >= 0 ? E.run(g, seat, n, () => {
      const hand = E.sortHand(g.hands[seat].slice(), gameCtx);
      const out = r.phase === 'play' ? E.unseen(seat).filter(c => E.isTr(c, g)) : [];
      return {
        hand: hand.map(c => c.id), trumps: hand.filter(c => E.isTr(c, gameCtx)).map(c => c.id),
        legal: myTurn ? E.legal(g.hands[seat], g).map(c => c.id) : [],
        trumpsOut: out.length, oberOut: out.filter(c => c.r === 'O').length, unterOut: out.filter(c => c.r === 'U').length,
      };
    }) : { hand: [], trumps: [], legal: [] };
    const bt = bidTurn(r);
    let bidOptions = null;
    if (bt === seat && seat >= 0) {
      const e = E.evalHand(g.hands[seat]); const cur = g.best ? g.best.rank : 0;
      bidOptions = { sau: cur < 1 ? e.sau.callable : [], high: cur < 2 };
    }
    const partnerKnown = g.type === 'sau' && (g.aceRevealed || seat === g.partner);
    const teamsKnown = g.type !== 'sau' || g.aceRevealed;
    v.game = Object.assign(x, {
      type: r.phase === 'bid' ? null : g.type, suit: g.suit, declarer: r.phase === 'bid' ? -1 : g.declarer,
      partner: partnerKnown ? g.partner : -1, partnerSecret: partnerKnown && !g.aceRevealed,
      name: r.phase === 'bid' ? null : E.gameName(g), trick: g.trick.map(t => ({ seat: t.seat, id: t.card.id })),
      trickWinner: g.trick.length === 4 ? E.winner(g.trick, g).seat : -1,
      counts: g.hands.map(h => h.length), turn: r.phase === 'play' ? g.turn : -1, bidTurn: bt, bids: g.bids, bidOptions,
      won: r.settings.aids ? g.won : null, teamsKnown, tricksDone: g.tricks.length,
      key: `${r.games}-${g.tricks.length}-${g.trick.length}`,
    });
  }
  return v;
}
function broadcast(r) {
  for (const c of r.clients) {
    try { c.res.write(`data: ${JSON.stringify(view(r, seatOf(r, c.token)))}\n\n`); } catch (e) { /* Verbindung weg */ }
  }
}
function update(r) { r.updated = Date.now(); broadcast(r); schedule(r); }

// ---------- HTTP ----------
function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 20000) { no(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } });
    req.on('error', no);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // unbekannter Pfad -> App ausliefern (z. B. /tisch/ABCDE)
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(d2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16); }

async function api(req, res, url) {
  const route = url.pathname;
  if (route === '/api/events' && req.method === 'GET') {
    const r = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
    if (!r) return send(res, 404, { error: 'Tisch nicht gefunden' });
    const t = String(url.searchParams.get('token') || '');
    const seat = seatOf(r, t);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { res, token: t };
    r.clients.add(client);
    if (seat >= 0) r.seats[seat].conn = (r.seats[seat].conn || 0) + 1;
    update(r);
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* */ } }, 20000);
    req.on('close', () => {
      clearInterval(ka); r.clients.delete(client);
      const s = seatOf(r, t);
      if (s >= 0) r.seats[s].conn = Math.max(0, (r.seats[s].conn || 1) - 1);
      update(r);
    });
    return;
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Ungültige Anfrage' }); }

  if (route === '/api/join') {
    const name = cleanName(body.name);
    if (!name) return send(res, 400, { error: 'Bitte gib deinen Namen ein.' });
    let r;
    if (body.code) { r = rooms.get(String(body.code).toUpperCase().trim()); if (!r) return send(res, 404, { error: 'Diesen Tisch gibt es nicht (mehr).' }); }
    else r = newRoom();
    let i = seatOf(r, body.token);
    if (i >= 0) { r.seats[i].name = name; r.seats[i].botControl = false; update(r); return send(res, 200, { code: r.code, token: body.token, seat: i }); }
    i = r.seats.findIndex(s => !s);
    if (i < 0 && ['lobby', 'end', 'none'].includes(r.phase)) i = r.seats.findIndex(s => s.bot);
    if (i < 0) return send(res, 409, { error: 'Der Tisch ist voll. Warte, bis das Spiel vorbei ist, oder bitte den Gastgeber, einen Bot-Platz freizugeben.' });
    const t = token();
    r.seats[i] = { name, token: t, bot: false, conn: 0 };
    if (!r.host || seatOf(r, r.host) < 0) r.host = t;
    r.msg = `${name} hat sich hingesetzt.`;
    update(r);
    return send(res, 200, { code: r.code, token: t, seat: i });
  }

  const r = rooms.get(String(body.code || '').toUpperCase());
  if (!r) return send(res, 404, { error: 'Tisch nicht gefunden' });
  const seat = seatOf(r, body.token);
  if (seat < 0) return send(res, 403, { error: 'Du sitzt nicht an diesem Tisch.' });
  const host = r.seats[seat].token === r.host;
  const between = ['lobby', 'end', 'none'].includes(r.phase);

  if (route === '/api/tip') {
    if (!r.settings.trainer) return send(res, 403, { error: 'Der Gastgeber hat den Trainer ausgeschaltet.' });
    const g = r.g;
    if (r.phase === 'bid' && bidTurn(r) === seat) {
      const html = E.run(g, seat, names(r), () => E.bidTipHTML(g.best ? g.best.rank : 0));
      return send(res, 200, { kind: 'bid', html });
    }
    if (r.phase === 'play' && g.turn === seat && g.trick.length < 4) {
      const key = `${r.games}-${g.tricks.length}-${g.trick.length}`;
      const a = E.run(g, seat, names(r), () => E.analyze());
      return send(res, 200, Object.assign({ kind: 'play', key }, a));
    }
    if (r.phase === 'play') return send(res, 200, { kind: 'info', html: E.run(g, seat, names(r), () => E.situation()) });
    return send(res, 200, { kind: 'info', html: 'Gerade gibt es nichts zu entscheiden.' });
  }

  if (route !== '/api/action') return send(res, 404, { error: 'Unbekannt' });
  const a = body.action || {};
  const fail = m => send(res, 400, { error: m });
  switch (a.type) {
    case 'chat': {
      const text = String(a.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      if (!text) return fail('Leer');
      r.chat.push({ name: r.seats[seat].name, seat, text, t: Date.now() });
      if (r.chat.length > 60) r.chat.splice(0, r.chat.length - 60);
      break;
    }
    case 'addBot': {
      if (!host) return fail('Nur der Gastgeber kann Bots hinzufügen.');
      const i = Number(a.seat);
      if (!(i >= 0 && i < 4) || r.seats[i]) return fail('Platz ist nicht frei.');
      const used = new Set(r.seats.filter(Boolean).map(s => s.name));
      const nm = BOTNAMES.find(b => !used.has(b)) || 'Bot ' + (i + 1);
      r.seats[i] = { name: nm, bot: true, conn: 0 };
      break;
    }
    case 'kick': {
      if (!host) return fail('Nur der Gastgeber kann Plätze freigeben.');
      const i = Number(a.seat);
      if (!(i >= 0 && i < 4) || !r.seats[i] || i === seat) return fail('Geht nicht.');
      if (r.phase === 'lobby') r.seats[i] = null;
      else { const used = new Set(r.seats.filter(Boolean).map(s => s.name)); r.seats[i] = { name: BOTNAMES.find(b => !used.has(b)) || 'Bot', bot: true, conn: 0 }; }
      break;
    }
    case 'takeover': {
      if (!host) return fail('Nur der Gastgeber kann einen Bot einspringen lassen.');
      const i = Number(a.seat);
      if (!(i >= 0 && i < 4) || !r.seats[i] || r.seats[i].bot) return fail('Geht nicht.');
      r.seats[i].botControl = !r.seats[i].botControl;
      if (!r.seats[i].botControl) { clearTimeout(r.timer); r.timer = null; }
      break;
    }
    case 'leave': {
      const nm = r.seats[seat].name;
      if (r.phase === 'lobby') r.seats[seat] = null;
      else { r.seats[seat].bot = true; r.seats[seat].token = null; r.seats[seat].name = nm + ' (Bot)'; }
      if (r.host === body.token) { const h = humans(r).find(s => s.token); r.host = h ? h.token : null; }
      r.msg = `${nm} ist aufgestanden.`;
      break;
    }
    case 'settings': {
      if (!host) return fail('Nur der Gastgeber kann das ändern.');
      if (typeof a.trainer === 'boolean') r.settings.trainer = a.trainer;
      if (typeof a.aids === 'boolean') r.settings.aids = a.aids;
      break;
    }
    case 'resetMoney': {
      if (!host || !between) return fail('Nur der Gastgeber, und nur zwischen den Spielen.');
      r.money = [0, 0, 0, 0]; r.msg = 'Kontostände zurückgesetzt.';
      break;
    }
    case 'start': {
      if (!host) return fail('Nur der Gastgeber kann starten.');
      if (r.phase !== 'lobby') return fail('Läuft schon.');
      if (r.seats.some(s => !s)) return fail('Es müssen alle 4 Plätze besetzt sein – füg Bots hinzu.');
      deal(r);
      break;
    }
    case 'next': {
      if (r.phase !== 'end' && r.phase !== 'none') return fail('Das Spiel läuft noch.');
      if (r.seats.some(s => !s)) return fail('Es fehlt ein Spieler.');
      deal(r);
      break;
    }
    case 'bid': {
      if (bidTurn(r) !== seat) return fail('Du bist nicht dran.');
      const bid = a.bid ? { type: a.bid.type, suit: a.bid.suit } : null;
      if (bid) bid.rank = bid.type === 'sau' ? 1 : 2;
      if (!validBid(r, seat, bid)) return fail('Diese Ansage ist nicht möglich.');
      doBid(r, seat, bid);
      break;
    }
    case 'play': {
      const g = r.g;
      if (r.phase !== 'play' || g.turn !== seat || g.trick.length >= 4 || r.collectTimer) return fail('Du bist nicht dran.');
      const c = g.hands[seat].find(x => x.id === a.card);
      if (!c) return fail('Die Karte hast du nicht.');
      const ok = E.run(g, seat, names(r), () => E.legal(g.hands[seat], g)).some(x => x.id === c.id);
      if (!ok) return fail(E.run(g, seat, names(r), () => E.explainIllegal(c)));
      doPlay(r, seat, c);
      break;
    }
    default: return fail('Unbekannte Aktion');
  }
  update(r);
  send(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch(err => { console.error(err); if (!res.headersSent) send(res, 500, { error: 'Serverfehler' }); });
    return;
  }
  serveStatic(req, res, url.pathname);
});

// Verlassene Tische nach 12 Stunden aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [c, r] of rooms) if (!r.clients.size && now - r.updated > 12 * 3600e3) { clearTimeout(r.timer); clearTimeout(r.collectTimer); rooms.delete(c); }
}, 10 * 60e3).unref();

server.listen(PORT, () => console.log(`Schafkopf läuft auf Port ${PORT}`));
module.exports = { server, rooms };
