// Tournament brackets for Pairings: Swiss pairings, KTS-style tiebreakers (with game wins)
// and single elimination. Pure functions, no DOM and no Supabase: the organizer's device
// works out each round and the server only stores it. Loaded by the app as
// window.PairingsBracket and by the tests through require() (tests/bracket.test.js).
//
// Shapes
//   player: { id, name?, dropped? }   dropped players are never paired again but keep
//                                     counting in their opponents' tiebreakers
//   match:  { round, p1, p2, result, p1Games?, p2Games? }
//           p2 = null is a bye. result is 'p1' | 'p2' | 'draw' | 'double_loss', or empty
//           while unreported. Games are optional; a result without them counts as a clean
//           win (2-0 in best-of-3, 1-0 in best-of-1), a draw as 1-1 (0-0 in best-of-1).
//
// Standings rank by match points (win 3, draw 1, loss 0), then the tiebreakers in
// `order` (default: OMW%, GW%, OOMW%, OGW%), then a random draw that is fixed by `seed`
// so it doesn't change between refreshes. Every percentage has a floor (default 25%) so
// meeting someone who dropped early doesn't sink you. A bye counts as a win (and a clean
// game score) but the bye is not an opponent, so it is left out of OMW/OGW.
(function(root){
  'use strict';

  const POINTS = { win: 3, draw: 1, loss: 0 };
  const TIEBREAKERS = ['omw', 'gw', 'oomw', 'ogw'];
  const DEFAULTS = { bestOf: 3, floor: 0.25, order: TIEBREAKERS, seed: '' };
  const RESULTS = ['p1', 'p2', 'draw', 'double_loss'];
  const EPS = 1e-9;

  const settings = opts => Object.assign({}, DEFAULTS, opts || {});
  const winsNeeded = bestOf => Math.max(1, Math.ceil((bestOf || 1) / 2));

  // ---------- Seeded draw for full ties (same seed, same order) ----------
  function hash(str){
    let h = 2166136261 >>> 0;
    for(const c of String(str)){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  // ---------- Results ----------
  // The score of one match as { result, g1, g2 }, filling in games that weren't typed.
  // null while the match is unreported.
  function scoreOf(m, bestOf){
    const need = winsNeeded(bestOf);
    if(m.p2 == null) return { result: 'bye', g1: need, g2: 0 };
    const typed = Number.isInteger(m.p1Games) && Number.isInteger(m.p2Games);
    const g = (a, b) => typed ? [m.p1Games, m.p2Games] : [a, b];
    let games;
    if(m.result === 'p1') games = g(need, 0);
    else if(m.result === 'p2') games = g(0, need);
    else if(m.result === 'draw') games = g(need > 1 ? 1 : 0, need > 1 ? 1 : 0);
    else if(m.result === 'double_loss') games = [0, 0];
    else return null;
    return { result: m.result, g1: games[0], g2: games[1] };
  }

  // Why a reported result can't be saved, or null if it's fine. `elim` forbids draws and
  // double losses (someone has to go through).
  function validateMatch(m, opts){
    const s = settings(opts), need = winsNeeded(s.bestOf);
    if(m.p2 == null) return null;
    if(!RESULTS.includes(m.result)) return 'result';
    if(s.elim && (m.result === 'draw' || m.result === 'double_loss')) return 'elim_needs_winner';
    const g1 = m.p1Games, g2 = m.p2Games;
    if(g1 == null && g2 == null) return null;
    if(!Number.isInteger(g1) || !Number.isInteger(g2) || g1 < 0 || g2 < 0 || g1 > need || g2 > need) return 'games';
    if(m.result === 'p1' && !(g1 > g2)) return 'games';
    if(m.result === 'p2' && !(g2 > g1)) return 'games';
    if(m.result === 'draw' && g1 !== g2) return 'games';
    if(m.result === 'double_loss' && (g1 || g2)) return 'games';
    return null;
  }

  // ---------- Standings ----------
  // Swiss matches only. opts.throughRound limits it to the rounds up to and including that one.
  function standings(players, matches, opts){
    const s = settings(opts);
    const rec = new Map();
    players.forEach(p => rec.set(p.id, {
      id: p.id, name: p.name, dropped: !!p.dropped,
      points: 0, wins: 0, losses: 0, draws: 0, byes: 0, played: 0,
      gamesWon: 0, gamesPlayed: 0, opponents: [],
    }));
    const add = (r, outcome, won, lost) => {
      r.played++;
      r.points += POINTS[outcome];
      r[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws']++;
      r.gamesWon += won; r.gamesPlayed += won + lost;
    };
    matches.forEach(m => {
      if(s.throughRound != null && m.round > s.throughRound) return;
      const sc = scoreOf(m, s.bestOf), a = rec.get(m.p1), b = m.p2 == null ? null : rec.get(m.p2);
      if(!sc || !a || (m.p2 != null && !b)) return;
      if(sc.result === 'bye'){ add(a, 'win', sc.g1, 0); a.byes++; return; }
      a.opponents.push(b.id); b.opponents.push(a.id);
      const [oa, ob] = sc.result === 'p1' ? ['win', 'loss'] : sc.result === 'p2' ? ['loss', 'win']
        : sc.result === 'draw' ? ['draw', 'draw'] : ['loss', 'loss'];
      add(a, oa, sc.g1, sc.g2); add(b, ob, sc.g2, sc.g1);
    });

    const rows = [...rec.values()];
    const floor = x => Math.max(s.floor, x);
    const avg = (ids, key) => ids.length ? ids.reduce((t, id) => t + rec.get(id)[key], 0) / ids.length : s.floor;
    rows.forEach(r => {
      r.mw = r.played ? floor(r.points / (POINTS.win * r.played)) : s.floor;
      r.gw = r.gamesPlayed ? floor(r.gamesWon / r.gamesPlayed) : s.floor;
    });
    rows.forEach(r => { r.omw = avg(r.opponents, 'mw'); r.ogw = avg(r.opponents, 'gw'); });
    rows.forEach(r => { r.oomw = avg(r.opponents, 'omw'); });

    const luck = new Map(rows.map(r => [r.id, hash(s.seed + ':' + r.id)]));
    rows.sort((a, b) => {
      if(a.points !== b.points) return b.points - a.points;
      for(const k of s.order){ if(Math.abs(a[k] - b[k]) > EPS) return b[k] - a[k]; }
      return luck.get(a.id) - luck.get(b.id);
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.tiebreak = [r.points].concat(s.order.map(k => String(Math.round(r[k] * 1000)).padStart(3, '0'))).join(' · ');
    });
    return rows;
  }

  // ---------- Swiss pairings ----------
  // Suggested number of Swiss rounds: enough for one undefeated player.
  const recommendedRounds = n => n < 2 ? 0 : Math.ceil(Math.log2(n));

  // Pairs everyone in `list` top-down, each with the nearest player they haven't met,
  // backtracking when that leaves someone further down stuck. null if impossible (or the
  // search runs out of budget).
  function pairUp(list, met, budget){
    if(!list.length) return [];
    const first = list[0], rest = list.slice(1);
    for(let i = 0; i < rest.length; i++){
      if(--budget.left < 0) return null;
      if(met.has(first + '|' + rest[i])) continue;
      const sub = pairUp(rest.slice(0, i).concat(rest.slice(i + 1)), met, budget);
      if(sub) return [[first, rest[i]]].concat(sub);
    }
    return null;
  }

  // Last resort when a rematch can't be avoided (small events, many rounds): still prefer
  // someone new, otherwise take the nearest player.
  function pairGreedy(list, met){
    const left = list.slice(), pairs = [];
    while(left.length > 1){
      const a = left.shift();
      let j = left.findIndex(b => !met.has(a + '|' + b));
      if(j < 0) j = 0;
      pairs.push([a, left.splice(j, 1)[0]]);
    }
    return pairs;
  }

  // The pairings for `round` from the matches of the rounds before it:
  // [{ table, p1, p2 }], tables numbered from the top, and a bye (p2 null, table null) last.
  // `rematch: true` on the result means one couldn't be avoided.
  function pairSwiss(players, matches, round, opts){
    const s = settings(opts);
    const prior = matches.filter(m => m.round < round);
    const table = standings(players, prior, s);
    // Pairing priority is the standings themselves: points, then tiebreakers, then the seeded
    // draw (which is all there is in round 1, so round 1 is a seeded shuffle).
    const order = table.filter(r => !r.dropped).map(r => r.id);
    const met = new Set(), hadBye = new Set();
    prior.forEach(m => {
      if(m.p2 == null) hadBye.add(m.p1);
      else { met.add(m.p1 + '|' + m.p2); met.add(m.p2 + '|' + m.p1); }
    });

    // The bye goes to the lowest-ranked player who hasn't had one (anyone, if all have).
    const rank = new Map(table.map(r => [r.id, r.rank]));
    const byLowest = order.slice().reverse();
    const byeChoices = order.length % 2 ? byLowest.filter(id => !hadBye.has(id)).concat(byLowest.filter(id => hadBye.has(id))) : [null];

    const budget = { left: 200000 };
    let pairs = null, bye = null, rematch = false;
    for(const candidate of byeChoices){
      pairs = pairUp(order.filter(id => id !== candidate), met, budget);
      if(pairs){ bye = candidate; break; }
      if(budget.left < 0) break;
    }
    if(!pairs){
      bye = byeChoices[0];
      pairs = pairGreedy(order.filter(id => id !== bye), met);
      rematch = pairs.some(([a, b]) => met.has(a + '|' + b));
    }

    const out = pairs.map(([a, b]) => rank.get(a) <= rank.get(b) ? [a, b] : [b, a])
      .sort((x, y) => Math.min(rank.get(x[0]), rank.get(x[1])) - Math.min(rank.get(y[0]), rank.get(y[1])))
      .map(([p1, p2], i) => ({ round, table: i + 1, p1, p2 }));
    if(bye != null) out.push({ round, table: null, p1: bye, p2: null });
    out.rematch = rematch;
    return out;
  }

  // ---------- Single elimination ----------
  // Bracket positions so the top seeds meet as late as possible: 1v8, 4v5, 2v7, 3v6.
  function seedOrder(size){
    let order = [1];
    while(order.length < size){ const n = order.length * 2; order = order.flatMap(x => [x, n + 1 - x]); }
    return order;
  }

  // The top `size` players still in the event, in standings order, as elimination seeds.
  const topCut = (rows, size) => rows.filter(r => !r.dropped).slice(0, size).map(r => r.id);

  // The whole bracket from the seeds (player ids, best first) and the elimination matches
  // reported so far ({ round, p1, p2, result }, rounds counted from 1 inside the bracket).
  // Missing seeds are byes for the top seeds. Returns
  //   { size, rounds: [[{ round, slot, p1, p2, bye, winner }]], champion, pending }
  // where pending lists the matches that can be played now.
  function elimination(seeds, matches){
    const size = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(seeds.length, 2))));
    const total = Math.log2(size), rounds = [];
    const winnerOf = (round, p1, p2) => {
      const m = (matches || []).find(x => x.round === round && ((x.p1 === p1 && x.p2 === p2) || (x.p1 === p2 && x.p2 === p1)));
      if(!m || (m.result !== 'p1' && m.result !== 'p2')) return null;
      return m.result === 'p1' ? m.p1 : m.p2;
    };
    const order = seedOrder(size);
    let entrants = order.map(n => n <= seeds.length ? seeds[n - 1] : null);
    for(let r = 1; r <= total; r++){
      const list = [];
      for(let slot = 0; slot < entrants.length / 2; slot++){
        const p1 = entrants[slot * 2], p2 = entrants[slot * 2 + 1];
        // In round 1 an empty slot is a bye; later it only means that match isn't decided yet.
        const bye = r === 1 && (p1 == null) !== (p2 == null);
        const winner = bye ? (p1 != null ? p1 : p2) : (p1 != null && p2 != null ? winnerOf(r, p1, p2) : null);
        list.push({ round: r, slot: slot + 1, p1, p2, bye, winner });
      }
      rounds.push(list);
      entrants = list.map(m => m.winner);
    }
    const champion = rounds[total - 1][0].winner;
    const pending = rounds.flat().filter(m => !m.bye && m.p1 != null && m.p2 != null && m.winner == null);
    return { size, rounds, champion, pending };
  }

  const api = {
    POINTS, TIEBREAKERS, DEFAULTS, RESULTS,
    winsNeeded, scoreOf, validateMatch, standings,
    recommendedRounds, pairSwiss,
    seedOrder, topCut, elimination,
  };
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.PairingsBracket = api;
})(this);
