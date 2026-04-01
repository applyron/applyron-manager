function deleteSearchParamsByPrefix(searchParams: URLSearchParams, prefix: string): void {
  const keys = Array.from(new Set(searchParams.keys()));
  for (const key of keys) {
    if (key === prefix || key.startsWith(`${prefix}[`)) {
      searchParams.delete(key);
    }
  }
}

export function ensureFreshCodexLoginUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    deleteSearchParamsByPrefix(url.searchParams, 'prompt');
    deleteSearchParamsByPrefix(url.searchParams, 'max_age');
    url.searchParams.delete('login_hint');

    const hostname = url.hostname.toLowerCase();
    const shouldForceAccountSelection =
      hostname === 'chatgpt.com' || hostname === 'chat.openai.com';

    if (shouldForceAccountSelection) {
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('max_age', '0');
      url.searchParams.set('applyron_login_nonce', `${Date.now()}`);
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}
