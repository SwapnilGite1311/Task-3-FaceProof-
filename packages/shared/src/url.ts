/**
 * Structural URL validation (SSRF defence, part 1 of 2).
 *
 * This module is pure so the browser can reuse it. It rejects everything that
 * is provably unsafe from the URL string alone. The API performs part 2 — DNS
 * resolution plus per-hop redirect checks — in `utils/safe-fetch.ts`, because a
 * public hostname can still resolve to a private address.
 */

export type UrlRejectionReason =
  | 'malformed'
  | 'protocol'
  | 'credentials'
  | 'port'
  | 'hostname'
  | 'private_address'
  | 'too_long';

export interface UrlValidationResult {
  ok: boolean;
  url?: URL;
  reason?: UrlRejectionReason;
  message?: string;
}

export const MAX_URL_LENGTH = 2048;

/** Ports a remote image is plausibly served from. */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
  // Cloud instance metadata services — the classic SSRF target.
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Hostname suffixes that only ever resolve inside a private network. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa', '.lan'];

export function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.');
  if (octets.length !== 4) return false;
  const nums = octets.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = nums as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 this network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved and broadcast
  return false;
}

export function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local fc00::/7
  if (value.startsWith('ff')) return true; // multicast
  // IPv4-mapped and IPv4-compatible addresses smuggle a v4 target through v6.
  const mapped = /(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped && mapped[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

/** True when the literal host string is a private or reserved IP address. */
export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIPv4(host);
  if (host.includes(':')) return isPrivateIPv6(host);
  // Decimal encoded IPv4, e.g. 2130706433 is 127.0.0.1
  if (/^\d+$/.test(host)) {
    const asNumber = Number(host);
    if (Number.isSafeInteger(asNumber) && asNumber <= 0xffffffff) {
      const dotted = [
        (asNumber >>> 24) & 255,
        (asNumber >>> 16) & 255,
        (asNumber >>> 8) & 255,
        asNumber & 255,
      ].join('.');
      return isPrivateIPv4(dotted);
    }
  }
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  return false;
}

/**
 * Validates a URL that the backend may be asked to fetch.
 * `allowHttp` is only enabled for local development storage URLs.
 */
export function validateExternalUrl(
  value: string,
  options: { allowHttp?: boolean } = {},
): UrlValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'malformed', message: 'URL is empty.' };
  }
  if (value.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'too_long', message: 'URL exceeds ' + MAX_URL_LENGTH + ' characters.' };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'malformed', message: 'URL could not be parsed.' };
  }

  const allowedProtocols = options.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    return {
      ok: false,
      reason: 'protocol',
      message: 'Protocol ' + url.protocol + ' is not allowed.',
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials',
      message: 'URLs with embedded credentials are rejected.',
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: 'port', message: 'Port ' + url.port + ' is not allowed.' };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: 'hostname', message: 'URL has no hostname.' };
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'hostname', message: 'Hostname ' + host + ' is blocked.' };
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: 'hostname', message: 'Hostname suffix of ' + host + ' is blocked.' };
  }
  if (!host.includes('.') && !host.includes(':')) {
    return { ok: false, reason: 'hostname', message: 'Bare hostnames are rejected.' };
  }
  if (isPrivateAddress(host)) {
    return {
      ok: false,
      reason: 'private_address',
      message: 'Host ' + host + ' is a private or reserved address.',
    };
  }

  return { ok: true, url };
}

export function isSafeExternalUrl(value: string): boolean {
  return validateExternalUrl(value).ok;
}
