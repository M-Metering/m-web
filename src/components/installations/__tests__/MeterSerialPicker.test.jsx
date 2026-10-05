// @vitest-environment jsdom
// The Assignments meter picker's counts (2026-10-05). Pinned: with a meter
// type selected, the count line and the dropdown describe THAT type's
// dispatchable meters — the "418 Three Phase available" report was the
// all-phase total shown under a Three Phase filter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MeterSerialPicker from '../MeterSerialPicker';
import { toMeterOptions } from '../../../utils/meterInventory';

vi.mock('../../services/api', () => ({ default: { searchMeters: vi.fn(), getMeterByNumber: vi.fn() } }));
afterEach(cleanup);

// 5 single-phase + 3 three-phase dispatchable meters, one three-phase stored
// as "3 Phase" (the import keeps raw cells), one held by an installer and one
// installed — neither of those two is dispatchable.
const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => ({ meterNumber: `010000000${i}`, phaseType: 'SINGLE PHASE', status: 'AVAILABLE' })),
  { meterNumber: '0200000001', phaseType: 'THREE PHASE', status: 'AVAILABLE' },
  { meterNumber: '0200000002', phaseType: 'THREE PHASE', status: 'AVAILABLE' },
  { meterNumber: '0200000003', phaseType: '3 Phase', status: 'AVAILABLE' },
  { meterNumber: '0200000004', phaseType: 'THREE PHASE', status: 'AVAILABLE' },
  { meterNumber: '0200000005', phaseType: 'THREE PHASE', status: 'INSTALLED' },
];
const HOLDERS = new Map([['0200000004', { installerName: 'John Doe' }]]);

const renderPicker = () => render(
  <MeterSerialPicker id="p" options={toMeterOptions(RECORDS, new Set(), HOLDERS)} loading={false} error={null}
    value={[]} onChange={() => {}} disabled={false} holders={HOLDERS} enforced={false} />
);

describe('MeterSerialPicker — counts follow the meter-type filter', () => {
  it('counts every dispatchable meter under "All phases", and each type separately in the dropdown', () => {
    renderPicker();
    expect(screen.getByText('8 available meters')).toBeTruthy();
    const select = screen.getByLabelText('Filter meters by phase');
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['All phases (8)', 'Single Phase (5)', 'Three Phase (3)']);
  });

  it('with Three Phase selected, shows the Three Phase count — never the all-phase total', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Filter meters by phase'), { target: { value: 'THREE PHASE' } });
    expect(screen.getByText('3 available Three Phase meters')).toBeTruthy();
    expect(screen.queryByText(/^8 available/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('a search says how many match out of the filtered total', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Filter meters by phase'), { target: { value: 'SINGLE PHASE' } });
    fireEvent.change(screen.getByPlaceholderText('Search meter serial number'), { target: { value: '0100000001' } });
    expect(screen.getByText('1 matching of 5 available Single Phase meters')).toBeTruthy();
  });
});
