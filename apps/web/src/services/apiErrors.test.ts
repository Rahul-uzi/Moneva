import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders, CanceledError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { describeApiError, isTransientError } from './apiClient';

/**
 * The dashboard used to show "Failed to load financial dashboard" whenever the
 * server was still starting up, which is the one case where waiting a moment
 * and asking again does work. These check that a request which never arrived
 * is told apart from one the server actually answered, because that decision
 * is what makes the difference between a retry and a dead end.
 */
const config = (): InternalAxiosRequestConfig => ({ headers: new AxiosHeaders() });

const withStatus = (status: number) =>
  new AxiosError('failed', String(status), config(), {}, {
    status,
    statusText: '',
    headers: {},
    config: config(),
    data: {},
  });

const noResponse = (code: string) => new AxiosError('failed', code, config(), {});

describe('isTransientError', () => {
  it('treats a timeout as worth retrying', () => {
    expect(isTransientError(noResponse(AxiosError.ECONNABORTED))).toBe(true);
  });

  it('treats an unreachable server as worth retrying', () => {
    expect(isTransientError(noResponse(AxiosError.ERR_NETWORK))).toBe(true);
  });

  it.each([502, 503, 504])('treats a %d from the host as worth retrying', (status) => {
    // The host answers with these while it is still starting the container.
    expect(isTransientError(withStatus(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 500])('does not retry a %d', (status) => {
    // The server answered. Asking again produces the same answer.
    expect(isTransientError(withStatus(status))).toBe(false);
  });

  it('does not retry a request we cancelled ourselves', () => {
    expect(isTransientError(new CanceledError('cancelled'))).toBe(false);
  });

  it('ignores errors that did not come from a request', () => {
    expect(isTransientError(new Error('render blew up'))).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('describeApiError', () => {
  it('prefers what the server said', () => {
    const err = new AxiosError('failed', '403', config(), {}, {
      status: 403,
      statusText: '',
      headers: {},
      config: config(),
      data: { detail: 'That account belongs to someone else.' },
    });
    expect(describeApiError(err, 'Failed to load.')).toBe('That account belongs to someone else.');
  });

  it('explains a request that never arrived', () => {
    expect(describeApiError(noResponse(AxiosError.ECONNABORTED), 'Failed to load.')).toMatch(
      /could not reach the server/i,
    );
  });

  it('falls back when the server answered without a message', () => {
    expect(describeApiError(withStatus(500), 'Failed to load.')).toBe('Failed to load.');
  });

  it('ignores a detail that is not a message', () => {
    // FastAPI reports validation failures as a list of objects, and rendering
    // one of those into the error banner produced "[object Object]".
    const err = new AxiosError('failed', '422', config(), {}, {
      status: 422,
      statusText: '',
      headers: {},
      config: config(),
      data: { detail: [{ loc: ['body', 'amount'], msg: 'field required' }] },
    });
    expect(describeApiError(err, 'Failed to save.')).toBe('Failed to save.');
  });

  it('ignores an empty message from the server', () => {
    const err = new AxiosError('failed', '500', config(), {}, {
      status: 500,
      statusText: '',
      headers: {},
      config: config(),
      data: { detail: '   ' },
    });
    expect(describeApiError(err, 'Failed to load.')).toBe('Failed to load.');
  });
});
