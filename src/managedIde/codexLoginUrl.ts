export function ensureFreshCodexLoginUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('max_age', '0');
    url.searchParams.delete('login_hint');
    url.searchParams.set('applyron_login_nonce', `${Date.now()}`);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
