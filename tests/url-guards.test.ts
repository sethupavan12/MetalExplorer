import { describe, expect, it } from 'vitest';
import { isAllowedLocalHttpUrl } from '../src/main/url-guards';

describe('isAllowedLocalHttpUrl', () => {
  it('allows only local http service URLs', () => {
    expect(isAllowedLocalHttpUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedLocalHttpUrl('https://127.0.0.1:5173/path')).toBe(true);
    expect(isAllowedLocalHttpUrl('http://[::1]:8080')).toBe(true);
    expect(isAllowedLocalHttpUrl('http://0.0.0.0:8080')).toBe(true);
  });

  it('blocks remote hosts and non-http schemes', () => {
    expect(isAllowedLocalHttpUrl('https://example.com')).toBe(false);
    expect(isAllowedLocalHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedLocalHttpUrl('mailto:security@example.com')).toBe(false);
    expect(isAllowedLocalHttpUrl('metalexplorer://open')).toBe(false);
  });
});
