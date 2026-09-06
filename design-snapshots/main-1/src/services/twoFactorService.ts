import { apiClient } from './apiClient';
import type { AuthTokens, TotpSetup, TotpEnableResult } from '../types/api';

/** Starts enrolment. The secret is inactive until enableTotp() confirms a code. */
export const setupTotp = async (): Promise<TotpSetup> => {
  const res = await apiClient.post<TotpSetup>('/auth/2fa/setup');
  return res.data;
};

/** Confirms enrolment with a live code and returns the one-time recovery codes. */
export const enableTotp = async (code: string): Promise<TotpEnableResult> => {
  const res = await apiClient.post<TotpEnableResult>('/auth/2fa/enable', { code });
  return res.data;
};

export const disableTotp = async (password: string, code: string): Promise<void> => {
  await apiClient.post('/auth/2fa/disable', { password, code });
};

/** Exchanges a login challenge plus a TOTP or recovery code for session tokens. */
export const verifyTotp = async (challengeToken: string, code: string): Promise<AuthTokens> => {
  const res = await apiClient.post<AuthTokens>('/auth/2fa/verify', {
    challenge_token: challengeToken,
    code,
  });
  return res.data;
};
