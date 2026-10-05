// @vitest-environment jsdom
// Only installers profiled for the disco are offered (§7): the API refuses a
// dispatch to anyone else. GET /users?role=INSTALLER&discoCode=X filters.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import InstallerSelect from '../InstallerSelect';
import jedApi from '../../services/api';

vi.mock('../../services/api', () => ({ default: { getUsers: vi.fn() } }));
const page = (data) => ({ success: true, data, pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false } });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('InstallerSelect — per disco', () => {
  it('asks the server for installers profiled for the disco, and clears a selection that is not', async () => {
    jedApi.getUsers.mockResolvedValue(page([{ id: 'u-2', firstName: 'Ada', lastName: 'Obi' }]));
    const onChange = vi.fn();
    render(<InstallerSelect value="u-1" onChange={onChange} discoCode="PHEDC" />);
    await waitFor(() => expect(jedApi.getUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'INSTALLER', discoCode: 'PHEDC' })));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('says when nobody is profiled for the disco yet', async () => {
    jedApi.getUsers.mockResolvedValue(page([]));
    render(<InstallerSelect value="" onChange={() => {}} discoCode="PHEDC" />);
    expect(await screen.findByText(/No installer is profiled for PHEDC yet/)).toBeTruthy();
  });

  it('without a disco, lists every installer the caller may see', async () => {
    jedApi.getUsers.mockResolvedValue(page([]));
    render(<InstallerSelect value="" onChange={() => {}} />);
    await waitFor(() => expect(jedApi.getUsers).toHaveBeenCalled());
    expect(jedApi.getUsers.mock.calls[0][0]).not.toHaveProperty('discoCode');
  });
});
