// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UpdateNews } from '../../services/updateCheck';

let native = true;
vi.mock('../../services/appUpdate', () => ({
  canSelfUpdate: () => native,
  UPDATE_ROUTE: '/profile?update=1',
}));

import { UpdateBanner } from './UpdateBanner';

const NEWS: UpdateNews = {
  current: 10015,
  latest: { version_code: 10016, version_name: '1.0.16', download_url: 'https://example.test/app.apk', notes: 'Fixes.', mandatory: false },
};

afterEach(() => { cleanup(); native = true; });

const show = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<UpdateBanner news={NEWS} onDismiss={() => {}} />} />
      <Route path="/profile" element={<p>Profile page</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('the update banner', () => {
  it('names the version and what changed', () => {
    show();
    expect(screen.getByText('MONEVA 1.0.16 is out')).toBeTruthy();
    expect(screen.getByText('Fixes.')).toBeTruthy();
  });

  // It used to be a link: the phone left MONEVA for Chrome's Downloads.
  it('starts the in-app update on the phone, without leaving the app', () => {
    show();
    const getIt = screen.getByRole('button', { name: 'Get it' });
    expect(getIt.tagName).toBe('BUTTON');
    fireEvent.click(getIt);
    expect(screen.getByText('Profile page')).toBeTruthy();
  });

  it('is still a download link where the app cannot update itself', () => {
    native = false;
    show();
    expect(screen.getByRole('link', { name: 'Get it' }).getAttribute('href')).toBe('https://example.test/app.apk');
  });
});
