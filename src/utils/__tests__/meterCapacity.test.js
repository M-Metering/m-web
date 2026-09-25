import { describe, it, expect } from 'vitest';
import {
  computeMeterCapacity,
  evaluateMeterDispatch,
  phaseCapacity,
  canDispatchPhase,
} from '../meterCapacity';

const jobs = (n, meterType = 'SINGLE PHASE', status = 'ASSIGNED') =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, status, meterType }));
const meters = (n, phaseType = 'SINGLE PHASE', assignmentStatus = 'ASSIGNED', offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ meterNumber: String(1000000000000 + offset + i), phaseType, assignmentStatus }));
const serials = (n, offset = 5000) => Array.from({ length: n }, (_, i) => String(2000000000000 + offset + i));

describe('computeMeterCapacity', () => {
  it('counts one required meter per open job and subtracts meters in hand', () => {
    const c = computeMeterCapacity({ openJobs: jobs(10), heldMeters: meters(3) });
    expect(c).toMatchObject({ required: 10, assigned: 3, remaining: 7, surplus: 0 });
  });

  it('only treats ASSIGNED and IN_PROGRESS jobs as needing a meter', () => {
    const open = [...jobs(2), ...jobs(1, 'SINGLE PHASE', 'IN_PROGRESS')];
    const closed = [...jobs(4, 'SINGLE PHASE', 'INSTALLED'), ...jobs(1, 'SINGLE PHASE', 'FAILED'), ...jobs(1, 'SINGLE PHASE', 'PENDING')];
    expect(computeMeterCapacity({ openJobs: [...open, ...closed] }).required).toBe(3);
  });

  it('ignores meters that are already used or returned', () => {
    const held = [...meters(2), ...meters(3, 'SINGLE PHASE', 'USED', 10), ...meters(1, 'SINGLE PHASE', 'RETURNED', 20)];
    expect(computeMeterCapacity({ openJobs: jobs(5), heldMeters: held })).toMatchObject({ assigned: 2, remaining: 3 });
  });

  it('never reports negative remaining and exposes the surplus instead', () => {
    const c = computeMeterCapacity({ openJobs: jobs(2), heldMeters: meters(5) });
    expect(c).toMatchObject({ remaining: 0, surplus: 3 });
  });

  it('breaks the figures down by phase, normalising phase spelling', () => {
    const c = computeMeterCapacity({
      openJobs: [...jobs(3, 'SINGLE PHASE'), ...jobs(2, 'Three Phase')],
      heldMeters: [...meters(1, 'single phase'), ...meters(2, 'THREE_PHASE', 'ASSIGNED', 50)],
    });
    expect(c.byPhase['SINGLE PHASE']).toEqual({ required: 3, assigned: 1, remaining: 2 });
    expect(c.byPhase['THREE PHASE']).toEqual({ required: 2, assigned: 2, remaining: 0 });
  });
});

describe('phaseCapacity / canDispatchPhase', () => {
  const capacity = computeMeterCapacity({
    openJobs: [...jobs(3, 'SINGLE PHASE'), ...jobs(2, 'THREE PHASE')],
    heldMeters: meters(3, 'SINGLE PHASE'),
  });

  it('reads a meter type the installer has no jobs for as all zeroes', () => {
    expect(phaseCapacity(capacity, 'SOMETHING ELSE')).toEqual({ required: 0, assigned: 0, remaining: 0 });
  });

  it('closes a meter type whose installations are all covered, and leaves the other open', () => {
    expect(canDispatchPhase(capacity, 'SINGLE PHASE')).toBe(false);
    expect(canDispatchPhase(capacity, 'THREE PHASE')).toBe(true);
  });

  it('opens every meter type for a role the cap does not apply to', () => {
    expect(canDispatchPhase(capacity, 'SINGLE PHASE', { enforce: false })).toBe(true);
    expect(canDispatchPhase(capacity, 'ANYTHING', { enforce: false })).toBe(true);
  });
});

describe('evaluateMeterDispatch — requirement table (installation requires 10)', () => {
  const capacity = computeMeterCapacity({ openJobs: jobs(10) });

  it.each([
    [0, 10, true],
    [3, 7, true],
    [7, 3, true],
    [10, 0, true],
    [11, -1, false],
  ])('assigning %i leaves %i → allowed=%s', (assign, remaining, allowed) => {
    const result = evaluateMeterDispatch(capacity, serials(assign));
    expect(result.remainingAfter).toBe(remaining);
    expect(result.allowed).toBe(allowed);
    if (!allowed) {
      expect(result.message).toBe('Only 10 more meters can be assigned to this installer.');
    }
  });
});

describe('evaluateMeterDispatch — per meter type', () => {
  // 10 pending Three Phase jobs, 6 Three Phase meters already with them.
  const capacity = computeMeterCapacity({
    openJobs: jobs(10, 'THREE PHASE'),
    heldMeters: meters(6, 'THREE PHASE'),
  });
  const three = (n, offset = 0) =>
    Array.from({ length: n }, (_, i) => String(3000000000000 + offset + i));
  const phaseMap = (list, phase) => new Map(list.map((s) => [s, phase]));

  it('allows exactly the remaining requirement for that meter type', () => {
    const picked = three(4);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.allowed).toBe(true);
    expect(result.message).toBeNull();
  });

  it('rejects one over, and says how many of that meter type are still needed', () => {
    const picked = three(5);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.phase).toBe('THREE PHASE');
    expect(result.message).toBe('Only 4 more Three Phase meters can be assigned to this installer.');
  });

  it('uses the singular when one meter of that type remains', () => {
    const c = computeMeterCapacity({ openJobs: jobs(7, 'THREE PHASE'), heldMeters: meters(6, 'THREE PHASE') });
    const picked = three(2, 100);
    const result = evaluateMeterDispatch(c, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.message).toBe('Only 1 more Three Phase meter can be assigned to this installer.');
  });

  it('blocks a meter type the installer has no pending jobs for, even when the total fits', () => {
    // 10 single-phase jobs, nothing held: total room for 10, but no three-phase job.
    const c = computeMeterCapacity({ openJobs: jobs(10, 'SINGLE PHASE') });
    const picked = three(1, 200);
    const result = evaluateMeterDispatch(c, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.message).toBe('No pending Three Phase installation is assigned to this installer.');
  });

  it('does not count serials the installer already holds against the phase limit', () => {
    const held = meters(6, 'THREE PHASE').map((m) => m.meterNumber);
    const picked = [...held, ...three(4, 300)];
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.alreadyHeld).toHaveLength(6);
    expect(result.requested).toBe(4);
    expect(result.allowed).toBe(true);
  });
});

describe('evaluateMeterDispatch — existing assignments', () => {
  it('accounts for meters already in hand', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(10), heldMeters: meters(7) });
    expect(evaluateMeterDispatch(capacity, serials(3)).allowed).toBe(true);
    expect(evaluateMeterDispatch(capacity, serials(4)).allowed).toBe(false);
  });

  it('does not double-count serials the installer already holds', () => {
    const held = meters(7);
    const capacity = computeMeterCapacity({ openJobs: jobs(10), heldMeters: held });
    const resend = [...held.slice(0, 5).map((m) => m.meterNumber), ...serials(3)];
    const result = evaluateMeterDispatch(capacity, resend);
    expect(result.alreadyHeld).toHaveLength(5);
    expect(result.requested).toBe(3);
    expect(result.allowed).toBe(true);
  });

  it('rejects any dispatch when nothing more is needed', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(2), heldMeters: meters(2) });
    const result = evaluateMeterDispatch(capacity, serials(1));
    expect(result.allowed).toBe(false);
    expect(result.message).toBe('Cannot assign these meters. The installer has no remaining installation capacity.');
  });
});

// The Admin assignment rules, stated as the acceptance criteria state them.
// One meter type must never consume another's capacity, and "no installation
// at all", "wrong meter type" and "that type is full" are three different
// answers because they need three different fixes.
describe('Admin meter-assignment rules', () => {
  const single = (n, offset = 0) => Array.from({ length: n }, (_, i) => String(4000000000000 + offset + i));
  const three = (n, offset = 0) => Array.from({ length: n }, (_, i) => String(5000000000000 + offset + i));
  const phaseMap = (list, phase) => new Map(list.map((s) => [s, phase]));

  it('1. rejects any meter when the installer has no installations at all', () => {
    const capacity = computeMeterCapacity({ openJobs: [] });
    const picked = single(1);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'SINGLE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.message).toBe('An installation must be assigned to this installer before assigning a meter.');
  });

  it('2. allows at most as many Single Phase meters as Single Phase installations', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(2, 'SINGLE PHASE') });
    const two = single(2);
    expect(evaluateMeterDispatch(capacity, two, { phaseBySerial: phaseMap(two, 'SINGLE PHASE') }).allowed).toBe(true);
    const three_ = single(3, 50);
    expect(evaluateMeterDispatch(capacity, three_, { phaseBySerial: phaseMap(three_, 'SINGLE PHASE') }).allowed).toBe(false);
  });

  it('3. rejects a Three Phase meter for an installer with only Single Phase installations', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(2, 'SINGLE PHASE') });
    const picked = three(1);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.message).toBe('No pending Three Phase installation is assigned to this installer.');
  });

  it('4. rejects a Single Phase meter for an installer with only Three Phase installations', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(2, 'THREE PHASE') });
    const picked = single(1, 100);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'SINGLE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.message).toBe('No pending Single Phase installation is assigned to this installer.');
  });

  it('5. allows up to 3 Single Phase and 2 Three Phase for a 3+2 installer', () => {
    const capacity = computeMeterCapacity({
      openJobs: [...jobs(3, 'SINGLE PHASE'), ...jobs(2, 'THREE PHASE')],
    });
    const mixed = [...single(3, 200), ...three(2, 200)];
    const map = new Map([
      ...single(3, 200).map((s) => [s, 'SINGLE PHASE']),
      ...three(2, 200).map((s) => [s, 'THREE PHASE']),
    ]);
    expect(evaluateMeterDispatch(capacity, mixed, { phaseBySerial: map }).allowed).toBe(true);

    const oneTooManySingle = [...single(4, 300), ...three(2, 300)];
    const map2 = new Map([
      ...single(4, 300).map((s) => [s, 'SINGLE PHASE']),
      ...three(2, 300).map((s) => [s, 'THREE PHASE']),
    ]);
    expect(evaluateMeterDispatch(capacity, oneTooManySingle, { phaseBySerial: map2 }).allowed).toBe(false);
  });

  it('6. rejects a further meter once every eligible installation is covered', () => {
    const capacity = computeMeterCapacity({
      openJobs: jobs(2, 'SINGLE PHASE'),
      heldMeters: meters(2, 'SINGLE PHASE'),
    });
    const picked = single(1, 400);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'SINGLE PHASE') });
    expect(result.allowed).toBe(false);
    expect(result.message).toBe(
      'Cannot assign this meter. The installer has no remaining installation capacity for this meter type.'
    );
  });

  it('7. a full Single Phase allocation does not consume Three Phase capacity', () => {
    // 5 single-phase jobs all covered, 2 three-phase jobs still open.
    const capacity = computeMeterCapacity({
      openJobs: [...jobs(5, 'SINGLE PHASE'), ...jobs(2, 'THREE PHASE')],
      heldMeters: meters(5, 'SINGLE PHASE'),
    });
    expect(capacity.byPhase['SINGLE PHASE'].remaining).toBe(0);
    expect(capacity.byPhase['THREE PHASE'].remaining).toBe(2);
    const picked = three(2, 500);
    expect(evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE') }).allowed).toBe(true);
  });

  it('8. removing an installation lowers that meter type’s available capacity', () => {
    const before = computeMeterCapacity({ openJobs: jobs(3, 'SINGLE PHASE'), heldMeters: meters(1, 'SINGLE PHASE') });
    expect(before.byPhase['SINGLE PHASE'].remaining).toBe(2);
    const after = computeMeterCapacity({ openJobs: jobs(2, 'SINGLE PHASE'), heldMeters: meters(1, 'SINGLE PHASE') });
    expect(after.byPhase['SINGLE PHASE'].remaining).toBe(1);
  });

  it('9. returning a meter raises that meter type’s available capacity again', () => {
    const out = computeMeterCapacity({ openJobs: jobs(3, 'SINGLE PHASE'), heldMeters: meters(2, 'SINGLE PHASE') });
    expect(out.byPhase['SINGLE PHASE'].remaining).toBe(1);
    // A returned meter is no longer in the installer's hands.
    const returned = computeMeterCapacity({
      openJobs: jobs(3, 'SINGLE PHASE'),
      heldMeters: [...meters(1, 'SINGLE PHASE'), ...meters(1, 'SINGLE PHASE', 'RETURNED', 90)],
    });
    expect(returned.byPhase['SINGLE PHASE'].remaining).toBe(2);
  });
});

describe('Super Admin assignment privileges (enforce: false)', () => {
  const single = (n, offset = 0) => Array.from({ length: n }, (_, i) => String(6000000000000 + offset + i));
  const phaseMap = (list, phase) => new Map(list.map((s) => [s, phase]));

  it('assigns meters to an installer with no installations at all', () => {
    const capacity = computeMeterCapacity({ openJobs: [] });
    const picked = single(2);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'SINGLE PHASE'), enforce: false });
    expect(result.allowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.enforced).toBe(false);
  });

  it('assigns a meter type the installer has no installation for', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(3, 'SINGLE PHASE') });
    const picked = single(1, 10);
    const result = evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'THREE PHASE'), enforce: false });
    expect(result.allowed).toBe(true);
  });

  it('assigns beyond the number of open installations', () => {
    const capacity = computeMeterCapacity({ openJobs: jobs(1, 'SINGLE PHASE') });
    const picked = single(5, 20);
    expect(evaluateMeterDispatch(capacity, picked, { phaseBySerial: phaseMap(picked, 'SINGLE PHASE'), enforce: false }).allowed).toBe(true);
  });

  it('still excludes serials the installer already holds, so nothing is re-sent', () => {
    const held = meters(2, 'SINGLE PHASE');
    const capacity = computeMeterCapacity({ openJobs: jobs(1), heldMeters: held });
    const resend = held.map((m) => m.meterNumber);
    const result = evaluateMeterDispatch(capacity, resend, { enforce: false });
    expect(result.alreadyHeld).toHaveLength(2);
    expect(result.requested).toBe(0);
    expect(result.allowed).toBe(false);
  });
});
