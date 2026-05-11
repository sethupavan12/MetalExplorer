const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function isAllowedLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HTTP_HOSTS.has(hostname);
  } catch {
    return false;
  }
}
