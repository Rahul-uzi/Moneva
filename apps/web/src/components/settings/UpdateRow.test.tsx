// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { LatestVersion } from '../../services/updateCheck';

const LATEST: LatestVersion = {
  version_code: 10016, version_name: '1.0.16', download_url: 'https://example.test/app.apk', notes: 'Fixes.', mandatory: false,
};

let resume: ((s: { isActive: boolean }) => void) | null = null;
vi.mock('@capacitor/app', () => ({
  App: { addListener: (_: string, fn: (s: { isActive: boolean }) => void) => { resume = fn; return Promise.resolve({ remove: () => {} }); } },
}));
vi.mock('../../services/updateCheck', () => ({ currentVersionName: () => '1.0.15' }));

const lookForUpdate = vi.fn();
const downloadUpdate = vi.fn();
const updaterStatus = vi.fn();
const openInstallPermission = vi.fn();
vi.mock('../../services/appUpdate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/appUpdate')>();
  return {
    ...real,
    canSelfUpdate: () => true,
    lookForUpdate: (...a: unknown[]) => lookForUpdate(...a),
    downloadUpdate: (...a: unknown[]) => downloadUpdate(...a),
    updaterStatus: () => updaterStatus(),
    openInstallPermission: () => openInstallPermission(),
    installUpdate: vi.fn(),
  };
});

import { UpdateRow } from './UpdateRow';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  updaterStatus.mockResolvedValue({ needsPermission: false });
  downloadUpdate.mockResolvedValue({ stage: 'ready', latest: LATEST, path: '/files/app.apk' });
  openInstallPermission.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); resume = null; });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const Where = () => <span data-testid="where">{useLocation().search}</span>;
const open = (path = '/profile') =>
  render(<MemoryRouter initialEntries={[path]}><UpdateRow /><Where /></MemoryRouter>);

describe('the update button', () => {
  it('waits to be pressed when opened normally', async () => {
    open();
    await settle();
    expect(lookForUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });

  // The banner's "Get it" and the shade notification both lead here.
  it('starts by itself when sent to update, and downloads straight away', async () => {
    lookForUpdate.mockResolvedValue({ stage: 'available', latest: LATEST });
    open('/profile?update=1');
    await settle();
    expect(lookForUpdate).toHaveBeenCalledTimes(1);
    expect(downloadUpdate).toHaveBeenCalledWith(LATEST, expect.any(Function));
    expect(screen.getByRole('button', { name: /install now/i })).toBeTruthy();
    // The flag is cleared, so it does not start again.
    expect(screen.getByTestId('where').textContent).toBe('');
  });

  it('stops at the permission step when Android has not allowed installs yet', async () => {
    lookForUpdate.mockResolvedValue({ stage: 'blocked', latest: LATEST });
    open('/profile?update=1');
    await settle();
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /allow updates/i })).toBeTruthy();
  });

  // Seen on the vivo: back from the settings switch, the button still said
  // "Allow updates", because the permission was read when the screen opened.
  it('carries on with the download on return once installs are allowed', async () => {
    lookForUpdate.mockResolvedValue({ stage: 'blocked', latest: LATEST });
    open();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /allow updates/i }));
    await settle();
    expect(openInstallPermission).toHaveBeenCalled();
    expect(downloadUpdate).not.toHaveBeenCalled();

    await act(async () => { resume?.({ isActive: true }); await new Promise((r) => setTimeout(r, 10)); });
    expect(downloadUpdate).toHaveBeenCalledWith(LATEST, expect.any(Function));
    expect(screen.getByRole('button', { name: /install now/i })).toBeTruthy();
  });

  it('stays put on return if installs are still not allowed', async () => {
    lookForUpdate.mockResolvedValue({ stage: 'blocked', latest: LATEST });
    open();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /allow updates/i }));
    await settle();
    updaterStatus.mockResolvedValue({ needsPermission: true });
    await act(async () => { resume?.({ isActive: true }); await new Promise((r) => setTimeout(r, 10)); });
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /allow updates/i })).toBeTruthy();
  });
});
