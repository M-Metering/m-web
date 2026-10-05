#!/usr/bin/env node
// scripts/diagnostics/verify-live-data.mjs
//
// READ-ONLY check of the live API for the root causes behind the 2026-09-27
// meter/revenue fixes. It issues GET requests only (plus the login POST) and
// changes nothing. Run it with a SUPERADMIN or ADMIN account:
//
//   ME_PHONE=080... ME_PASSWORD=... node scripts/diagnostics/verify-live-data.mjs
//   ME_PHONE=... ME_PASSWORD=... node scripts/diagnostics/verify-live-data.mjs --meter 0239110006909
//
// Optional: ME_API_BASE (default https://api.memetering.com/api/v1).
//
// What it reports:
//   1. Every raw `status` and `phaseType` spelling in the meter inventory —
//      a non-canonical value ("Available", "3 Phase") is what an exact-match
//      server filter (GET /meters?status=AVAILABLE&phaseType=THREE PHASE)
//      silently drops.
//   2. Whether GET /meters rows carry `assignmentStatus` at all (API gap G).
//   3. Meters that ARE available but are missing from the status=AVAILABLE
//      scan the Assignments page used — split by phase.
//   4. Whether paging GET /meters twice returns the same set (an unstable
//      order drops rows between pages).
//   5. Meters out with an installer (open dispatch batches) whose inventory
//      `status` still reads AVAILABLE — expected by the API's design, and the
//      reason Meter Schedule now reads the batches too.
//   6. Revenue: rows vs meta.totals, and the pending/completed split.
//   7. With --meter N: that meter through every lookup path.
//  11. Phase reconciliation (2026-10-05, the "418 vs 59 Three Phase" report):
//      per canonical phase, total / available / held / on the shelf /
//      installed / faulty / retired from the full inventory scan, next to
//      /meters/statistics, the exact-match GET /meters?phaseType= totals, and
//      what each screen should therefore show.

const BASE = (process.env.ME_API_BASE || 'https://api.memetering.com/api/v1').replace(/\/$/, '');
const PHONE = process.env.ME_PHONE;
const PASSWORD = process.env.ME_PASSWORD;
const meterArg = (() => { const i = process.argv.indexOf('--meter'); return i > 0 ? process.argv[i + 1] : null; })();

if (!PHONE || !PASSWORD) {
  console.error('Set ME_PHONE and ME_PASSWORD (an ADMIN or SUPERADMIN account).');
  process.exit(1);
}

let token = null;
async function api(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v); });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const rowsOf = (body) => {
  if (Array.isArray(body?.data)) return body.data;
  for (const k of ['meters', 'items', 'results', 'data']) if (Array.isArray(body?.data?.[k])) return body.data[k];
  return [];
};
const pagesOf = (body) => {
  const p = body?.pagination || body?.data?.pagination || {};
  return Number(p.totalPages ?? p.pages) || null;
};
async function scan(path, params = {}, maxPages = 200) {
  const first = await api(path, { ...params, page: 1, limit: 100 });
  if (first.status !== 200) throw new Error(`${path} → HTTP ${first.status}`);
  const rows = [...rowsOf(first.body)];
  const total = pagesOf(first.body);
  let page = 2;
  while (page <= maxPages && (total ? page <= total : rowsOf(first.body).length === 100)) {
    const next = await api(path, { ...params, page, limit: 100 });
    const r = rowsOf(next.body);
    if (r.length === 0) break;
    rows.push(...r);
    page += 1;
    if (!total && r.length < 100) break;
  }
  return { rows, first: first.body };
}
const tally = (list, key) => list.reduce((m, r) => { const v = JSON.stringify(r?.[key] ?? null); m[v] = (m[v] || 0) + 1; return m; }, {});
const upper = (v) => String(v ?? '').trim().toUpperCase();
const canonPhase = (v) => {
  const compact = upper(v).replace(/[_-]+/g, ' ').replace(/\bMETERS?\b/g, '').replace(/\s+/g, '');
  if (/^(3|THREE|TRIPLE)(PHASE|PH|P)?$/.test(compact)) return 'THREE PHASE';
  if (/^(1|ONE|SINGLE)(PHASE|PH|P)?$/.test(compact)) return 'SINGLE PHASE';
  return upper(v);
};
const section = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE, password: PASSWORD }),
  });
  const lb = await login.json().catch(() => null);
  token = lb?.data?.token || lb?.token || lb?.data?.accessToken;
  if (!token) { console.error('Login failed:', login.status); process.exit(1); }

  section('1. Meter inventory: raw status / phaseType spellings');
  const all = await scan('/meters');
  console.log(`GET /meters (no filter): ${all.rows.length} rows`);
  console.log('status   :', tally(all.rows, 'status'));
  console.log('phaseType:', tally(all.rows, 'phaseType'));

  section('2. Does GET /meters carry assignmentStatus?');
  const withAssign = all.rows.filter((r) => 'assignmentStatus' in r).length;
  console.log(`${withAssign} of ${all.rows.length} rows have an assignmentStatus key`, withAssign ? tally(all.rows, 'assignmentStatus') : '');

  section('3. Available meters missing from the status=AVAILABLE scan');
  const avail = await scan('/meters', { status: 'AVAILABLE' });
  const availSet = new Set(avail.rows.map((r) => String(r.meterNumber)));
  const shouldBe = all.rows.filter((r) => upper(r.status) === 'AVAILABLE');
  const missing = shouldBe.filter((r) => !availSet.has(String(r.meterNumber)));
  console.log(`status normalises to AVAILABLE: ${shouldBe.length}; returned by status=AVAILABLE: ${avail.rows.length}; missing: ${missing.length}`);
  console.log('missing by phase:', missing.reduce((m, r) => { const k = canonPhase(r.phaseType); m[k] = (m[k] || 0) + 1; return m; }, {}));
  missing.slice(0, 10).forEach((r) => console.log('  e.g.', r.meterNumber, JSON.stringify(r.status), JSON.stringify(r.phaseType)));

  section('4. Paging stability (same filter read twice)');
  const again = await scan('/meters', { status: 'AVAILABLE' });
  const againSet = new Set(again.rows.map((r) => String(r.meterNumber)));
  const onlyFirst = [...availSet].filter((s) => !againSet.has(s)).length;
  const dupes = avail.rows.length - availSet.size;
  console.log(`read 1: ${availSet.size} unique (${dupes} duplicated across pages); read 2: ${againSet.size}; in read 1 only: ${onlyFirst}`);

  section('5. Meters with an installer (open batches) vs inventory status');
  const batches = [];
  for (const status of ['ACTIVE', 'PARTIALLY_RETURNED']) batches.push(...(await scan('/assignments', { assignmentType: 'METER', status })).rows);
  const held = new Map();
  for (const b of batches) {
    const d = (await api(`/assignments/${b.id}`)).body?.data || {};
    (d.items || []).filter((i) => upper(i.assignmentStatus) === 'ASSIGNED')
      .forEach((i) => held.set(String(i.meterNumber), b.installerName || b.installerId));
  }
  const byNumber = new Map(all.rows.map((r) => [String(r.meterNumber), r]));
  const heldButAvailable = [...held.keys()].filter((s) => upper(byNumber.get(s)?.status) === 'AVAILABLE');
  console.log(`${batches.length} open METER batches; ${held.size} meters out with installers; ${heldButAvailable.length} of them still read status AVAILABLE`);
  const heldInAvailScan = [...held.keys()].filter((s) => availSet.has(s)).length;
  console.log(`${heldInAvailScan} held meters are returned by GET /meters?status=AVAILABLE (they must be filtered out client-side)`);

  section('6. Revenue (GET /finance/revenue/transactions)');
  const rev = await scan('/finance/revenue/transactions');
  const totals = rev.first?.meta?.totals || {};
  const sum = rev.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const completed = new Set(['INSTALLED', 'EXPORTED', 'COMPLETED']);
  const due = rev.rows.filter((r) => completed.has(upper(r.sourceStatus))).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  console.log(`rows: ${rev.rows.length} / meta.totals.count ${totals.count}; row sum ${sum} / meta.totals.amount ${totals.amount}`);
  console.log(`Total collected (pending) = ${sum - due}; Revenue due (completed) = ${due}`);
  console.log('sourceStatus:', tally(rev.rows, 'sourceStatus'));

  section('8. Dashboard KPIs: aggregates vs a full recount');
  const statsRes = (await api('/installations/statistics')).body;
  const st = statsRes?.data ?? statsRes ?? {};
  const jedCount = async (status) => (await api('/external/jed/requests', { status, page: 1, limit: 1 })).body?.pagination?.totalCount;
  const [paid, completedJed, initiated] = [await jedCount('PAID'), await jedCount('COMPLETED'), await jedCount('INITIATED')];
  const kpiPending = st.pending + st.assigned + st.inProgress + st.failed + paid;
  const kpiCompleted = st.installed + st.exported + completedJed;
  console.log('statistics:', st, '| JED PAID', paid, 'COMPLETED', completedJed, 'INITIATED', initiated);
  console.log(`Dashboard would show — Pending: ${kpiPending}, Completed: ${kpiCompleted}`);
  const allImported = (await scan('/installations')).rows;
  const allJed = (await scan('/external/jed/requests')).rows;
  const byStatus = (list) => list.reduce((m, r) => { const k = upper(r.status); m[k] = (m[k] || 0) + 1; return m; }, {});
  const ic = byStatus(allImported); const jc = byStatus(allJed);
  const rePending = (ic.PENDING || 0) + (ic.ASSIGNED || 0) + (ic.IN_PROGRESS || 0) + (ic.FAILED || 0) + (jc.PAID || 0);
  const reCompleted = (ic.INSTALLED || 0) + (ic.EXPORTED || 0) + (jc.COMPLETED || 0);
  console.log(`Recount from every row — Pending: ${rePending}, Completed: ${reCompleted}`,
    rePending === kpiPending && reCompleted === kpiCompleted ? '✓ reconciles' : '✗ MISMATCH');
  console.log('imported by status:', ic, '| JED by status:', jc);

  section('9. Recent: server order and the true newest five');
  const direction = (list, field) => {
    const t = list.slice(0, 10).map((r) => Date.parse(r[field])).filter(Number.isFinite);
    if (t.length < 2) return 'unknown';
    return t.every((v, i) => i === 0 || v <= t[i - 1]) ? 'newest first'
      : t.every((v, i) => i === 0 || v >= t[i - 1]) ? 'oldest first' : 'unordered';
  };
  console.log('GET /installations page order by createdAt:', direction(allImported, 'createdAt'));
  console.log('GET /external/jed/requests page order by dateRequested:', direction(allJed, 'dateRequested'));
  const newest = [
    ...allImported.map((r) => ({ at: r.createdAt, who: r.customerName, acct: r.accountNumber, status: r.status })),
    ...allJed.map((r) => ({ at: r.dateRequested, who: r.custNames, acct: r.accountNumber, status: r.status })),
  ].filter((r) => r.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  console.table(newest);

  section('10. Total collected payments = pending installations at current meter-type prices');
  const types = (await scan('/settings/meter-type')).rows;
  console.log('meter types:', types.map((t) => `${t.name}=${t.amount}${t.isActive === false ? ' (inactive)' : ''}`).join(' | '));
  const price = new Map();
  types.filter((t) => t.isActive !== false && Number(t.amount) > 0).forEach((t) => price.set(canonPhase(t.name), Number(t.amount)));
  const pendingRows = [
    ...allImported.filter((r) => ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED'].includes(upper(r.status))).map((r) => r.meterType),
    ...allJed.filter((r) => upper(r.status) === 'PAID').map((r) => r.meterType || r.meterRecommended),
  ];
  const byType = {};
  let value = 0; let unpriced = 0;
  pendingRows.forEach((mt) => {
    const k = canonPhase(mt) || '(none)';
    byType[k] = (byType[k] || 0) + 1;
    if (price.has(k)) value += price.get(k); else unpriced += 1;
  });
  console.log(`pending rows: ${pendingRows.length} (Dashboard pending ${kpiPending}) by type:`, byType);
  console.log(`Expected Total collected payments: ${value}; not valued (no type/price): ${unpriced} — compare with the Dashboard, Reports and Installations panels`);

  section('11. Phase reconciliation (inventory scan vs /meters/statistics vs each screen)');
  {
    const st = (await api('/meters/statistics')).body?.data || {};
    const rows = [];
    for (const phase of ['SINGLE PHASE', 'THREE PHASE']) {
      const mine = all.rows.filter((r) => canonPhase(r.phaseType) === phase);
      const by = (status) => mine.filter((r) => upper(r.status) === status).length;
      const heldHere = mine.filter((r) => held.has(String(r.meterNumber))).length;
      const exact = await api('/meters', { phaseType: phase, page: 1, limit: 1 });
      const p = exact.body?.pagination || {};
      rows.push({
        phase,
        'total (scan)': mine.length,
        'raw spellings': Object.keys(tally(mine, 'phaseType')).join(' '),
        'exact-match GET total': p.totalCount ?? p.total ?? '?',
        'statistics card': phase === 'THREE PHASE' ? st.threePhase : st.singlePhase,
        'status AVAILABLE': by('AVAILABLE'),
        'held (assigned)': heldHere,
        'on shelf = picker': by('AVAILABLE') - mine.filter((r) => upper(r.status) === 'AVAILABLE' && held.has(String(r.meterNumber))).length,
        installed: by('INSTALLED'),
        faulty: by('FAULTY'),
        retired: by('RETIRED'),
      });
    }
    console.table(rows);
    const heldAvailable = all.rows.filter((r) => upper(r.status) === 'AVAILABLE' && held.has(String(r.meterNumber))).length;
    console.log(`statistics: total ${st.totalMeters}, available ${st.available}, installed ${st.installed}, single ${st.singlePhase}, three ${st.threePhase}`);
    console.log(`Meter Schedule "Available" should read ${Number(st.available) - held.size} (statistics available − ${held.size} held; ${heldAvailable} of the held are status AVAILABLE in the scan).`);
    console.log('Assignments picker: "All phases (N)" = sum of "on shelf"; "Three Phase (N)" = the THREE PHASE "on shelf" figure.');
    console.log('Meter Schedule "Three Phase" = the statistics card (every status). If it differs from "total (scan)", the');
    console.log('server is counting raw spellings differently from the app — see "raw spellings" and "exact-match GET total".');
  }

  if (meterArg) {
    section(`7. Meter ${meterArg} through every path`);
    console.log('inventory row :', byNumber.get(meterArg) || 'not in GET /meters');
    console.log('in AVAILABLE scan:', availSet.has(meterArg), '| held by:', held.get(meterArg) || 'nobody');
    console.log('by number     :', (await api(`/meters/meter-number/${encodeURIComponent(meterArg)}`)).body);
    console.log('search        :', rowsOf((await api('/meters/search', { q: meterArg })).body));
  }
})().catch((err) => { console.error(err); process.exit(1); });
