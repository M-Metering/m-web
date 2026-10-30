// @vitest-environment jsdom
// The Assignments meter picker's counts (2026-10-05). Pinned: with a meter
// type selected, the count line and the dropdown describe THAT type's
// dispatchable meters — the "418 Three Phase available" report was the
// all-phase total shown under a Three Phase filter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import MeterSerialPicker from '../MeterSerialPicker';
import { toMeterOptions } from '../../../utils/meterInventory';
import jedApi from '../../services/api';

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

// 2026-10-30: PHEDC serials pasted while the batch's disco was ABA_POWER were
// accepted, then every row was rejected at submit. The paste now checks the
// meter's own disco and offers to switch.
describe('MeterSerialPicker — pasting another disco\'s meters', () => {
  const PHEDC = ['0239110211103', '0239110211111'];
  const paste = async (props) => {
    jedApi.getMeterByNumber.mockImplementation(async (serial) => ({
      data: { meterNumber: serial, phaseType: 'SINGLE PHASE', status: 'AVAILABLE', assignmentStatus: 'UNASSIGNED', discoCode: 'PHEDC' },
    }));
    const onChange = vi.fn();
    const onSwitchDisco = vi.fn();
    render(
      <MeterSerialPicker id="p" options={toMeterOptions(RECORDS, new Set(), HOLDERS)} loading={false} error={null}
        value={[]} onChange={onChange} disabled={false} holders={HOLDERS} enforced={false}
        discoCode="ABA_POWER" onSwitchDisco={onSwitchDisco} {...props} />
    );
    fireEvent.click(screen.getByText('Paste serials'));
    fireEvent.change(screen.getByLabelText('Paste meter serial numbers'), { target: { value: PHEDC.join('\n') } });
    fireEvent.click(screen.getByText('Add to selection'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('0 added.'));
    return { onChange, onSwitchDisco };
  };

  it('refuses them, names their disco, and offers the switch', async () => {
    const { onChange, onSwitchDisco } = await paste({ switchableDiscos: ['ABA_POWER', 'PHEDC'] });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('0239110211103 (PHEDC stock — choose PHEDC as the Disco)');
    fireEvent.click(screen.getByText('Switch Disco to PHEDC'));
    expect(onSwitchDisco).toHaveBeenCalledWith('PHEDC');
  });

  it('does not offer a disco the user cannot use', async () => {
    await paste({ switchableDiscos: ['ABA_POWER'] });
    expect(screen.queryByText('Switch Disco to PHEDC')).toBeNull();
  });
});
