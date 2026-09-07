import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  extractHandle,
  isPrivateAddress,
  isSafeExternalUrl,
  validateExternalUrl,
} from '@faceproof/shared';
import { canonicalizeResultUrl } from '../src/modules/reverse-search/normalize';

describe('validateExternalUrl', () => {
  it('accepts ordinary https URLs', () => {
    const result = validateExternalUrl('https://www.instagram.com/p/Cabcdefghij/');
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe('www.instagram.com');
  });

  it('rejects http unless explicitly allowed', () => {
    expect(validateExternalUrl('http://example.com/a.jpg').ok).toBe(false);
    expect(validateExternalUrl('http://example.com/a.jpg', { allowHttp: true }).ok).toBe(true);
  });

  it('rejects non-http protocols', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a.jpg',
      'gopher://example.com/',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
    ]) {
      expect(validateExternalUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects embedded credentials', () => {
    const result = validateExternalUrl('https://user:pass@example.com/a.jpg');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('credentials');
  });

  it('rejects unusual ports', () => {
    expect(validateExternalUrl('https://example.com:22/a').reason).toBe('port');
    expect(validateExternalUrl('https://example.com:5432/a').reason).toBe('port');
    expect(validateExternalUrl('https://example.com:8443/a').ok).toBe(true);
  });

  it('rejects loopback and link-local hosts', () => {
    for (const url of [
      'https://localhost/a',
      'https://127.0.0.1/a',
      'https://[::1]/a',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(validateExternalUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects the RFC1918 ranges', () => {
    for (const url of [
      'https://10.0.0.1/a',
      'https://172.16.5.4/a',
      'https://172.31.255.255/a',
      'https://192.168.1.1/a',
      'https://100.100.0.1/a',
    ]) {
      expect(validateExternalUrl(url).reason, url).toBe('private_address');
    }
  });

  it('allows public addresses that merely look similar', () => {
    expect(validateExternalUrl('https://172.32.0.1/a').ok).toBe(true);
    expect(validateExternalUrl('https://11.0.0.1/a').ok).toBe(true);
    expect(validateExternalUrl('https://8.8.8.8/a').ok).toBe(true);
  });

  it('rejects decimal and hex encoded loopback addresses', () => {
    // 2130706433 === 127.0.0.1
    expect(validateExternalUrl('https://2130706433/a').ok).toBe(false);
    expect(validateExternalUrl('https://0x7f000001/a').ok).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 loopback', () => {
    expect(isPrivateAddress('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('rejects internal-only hostname suffixes and bare hostnames', () => {
    expect(validateExternalUrl('https://db.internal/a').ok).toBe(false);
    expect(validateExternalUrl('https://printer.local/a').ok).toBe(false);
    expect(validateExternalUrl('https://intranet/a').ok).toBe(false);
  });

  it('rejects malformed and oversized URLs', () => {
    expect(validateExternalUrl('not a url').reason).toBe('malformed');
    expect(validateExternalUrl('').reason).toBe('malformed');
    expect(validateExternalUrl(`https://example.com/${'a'.repeat(3000)}`).reason).toBe('too_long');
  });

  it('exposes a boolean helper', () => {
    expect(isSafeExternalUrl('https://x.com/user/status/1')).toBe(true);
    expect(isSafeExternalUrl('http://127.0.0.1')).toBe(false);
  });
});

describe('canonicalizeResultUrl', () => {
  it('strips tracking parameters and fragments', () => {
    expect(
      canonicalizeResultUrl('https://example.com/photo?utm_source=x&fbclid=1&id=7#section'),
    ).toBe('https://example.com/photo?id=7');
  });

  it('normalises trailing slashes so duplicates collapse', () => {
    expect(canonicalizeResultUrl('https://example.com/a/b/')).toBe(
      canonicalizeResultUrl('https://example.com/a/b'),
    );
  });

  it('returns null for unsafe URLs instead of repairing them', () => {
    expect(canonicalizeResultUrl('http://169.254.169.254/')).toBeNull();
    expect(canonicalizeResultUrl('nonsense')).toBeNull();
  });
});

describe('platform detection', () => {
  it('recognises the major platforms', () => {
    expect(detectPlatform('https://www.instagram.com/p/Cabc/')).toBe('Instagram');
    expect(detectPlatform('https://x.com/someone/status/1')).toBe('X');
    expect(detectPlatform('https://twitter.com/someone/status/1')).toBe('X');
    expect(detectPlatform('https://www.facebook.com/photo?fbid=1')).toBe('Facebook');
    expect(detectPlatform('https://www.tiktok.com/@someone/video/1')).toBe('TikTok');
    expect(detectPlatform('https://www.reddit.com/r/pics/comments/1/x/')).toBe('Reddit');
    expect(detectPlatform('https://www.pinterest.com/pin/12345/')).toBe('Pinterest');
  });

  it('returns undefined for ordinary websites', () => {
    expect(detectPlatform('https://news.example.org/article')).toBeUndefined();
  });

  it('extracts public handles where the URL layout allows', () => {
    expect(extractHandle('https://www.instagram.com/someone/')).toBe('@someone');
    expect(extractHandle('https://x.com/someone/status/1')).toBe('@someone');
    expect(extractHandle('https://www.tiktok.com/@someone/video/1')).toBe('@someone');
    expect(extractHandle('https://www.reddit.com/r/pics/comments/1/x/')).toBe('r/pics');
  });

  it('does not mistake a post path segment for a handle', () => {
    expect(extractHandle('https://www.instagram.com/p/Cabcdefghij/')).toBeUndefined();
    expect(extractHandle('https://x.com/i/web/status/1')).toBeUndefined();
  });
});
