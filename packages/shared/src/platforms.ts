/**
 * Recognition of public social platforms in reverse-search results.
 *
 * The list is used only to *classify* URLs that a search provider genuinely
 * returned. It never invents a result and never implies that a URL is a match.
 */

export interface PlatformDefinition {
  id: string;
  label: string;
  /** Hostnames (without leading `www.`) that belong to the platform. */
  hosts: string[];
  /** Extracts a public handle from the URL path, when the layout allows it. */
  handleFrom?: (url: URL) => string | undefined;
  /** Relative trust weight used when ranking candidates. */
  weight: number;
}

const firstSegment = (url: URL): string | undefined => {
  const segment = url.pathname.split('/').filter(Boolean)[0];
  return segment ? decodeURIComponent(segment) : undefined;
};

const handleAt = (url: URL, index: number, skip: string[] = []): string | undefined => {
  const parts = url.pathname.split('/').filter(Boolean);
  const raw = parts[index];
  if (!raw) return undefined;
  const value = decodeURIComponent(raw).replace(/^@/, '');
  if (skip.includes(value.toLowerCase())) return undefined;
  return value ? `@${value}` : undefined;
};

export const SOCIAL_PLATFORMS: PlatformDefinition[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    hosts: ['instagram.com', 'instagr.am', 'cdninstagram.com'],
    handleFrom: (url) => handleAt(url, 0, ['p', 'reel', 'reels', 'tv', 'explore', 'stories']),
    weight: 1,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    hosts: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
    handleFrom: (url) => handleAt(url, 0, ['photo', 'photo.php', 'watch', 'groups', 'permalink.php']),
    weight: 0.95,
  },
  {
    id: 'x',
    label: 'X',
    hosts: ['x.com', 'twitter.com', 'mobile.twitter.com', 'nitter.net'],
    handleFrom: (url) => handleAt(url, 0, ['i', 'search', 'hashtag', 'intent']),
    weight: 0.95,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hosts: ['tiktok.com', 'vm.tiktok.com'],
    handleFrom: (url) => {
      const segment = firstSegment(url);
      return segment?.startsWith('@') ? segment : undefined;
    },
    weight: 0.9,
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    hosts: ['pinterest.com', 'pin.it', 'pinimg.com'],
    handleFrom: (url) => handleAt(url, 0, ['pin', 'search', 'ideas']),
    weight: 0.7,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    hosts: ['reddit.com', 'redd.it', 'redditmedia.com'],
    handleFrom: (url) => {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'r' && parts[1]) return `r/${parts[1]}`;
      if (parts[0] === 'user' && parts[1]) return `u/${parts[1]}`;
      return undefined;
    },
    weight: 0.8,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    hosts: ['linkedin.com', 'lnkd.in'],
    handleFrom: (url) => handleAt(url, 1, []),
    weight: 0.85,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be'],
    handleFrom: (url) => {
      const segment = firstSegment(url);
      return segment?.startsWith('@') ? segment : undefined;
    },
    weight: 0.8,
  },
  {
    id: 'threads',
    label: 'Threads',
    hosts: ['threads.net', 'threads.com'],
    handleFrom: (url) => handleAt(url, 0, ['t']),
    weight: 0.85,
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    hosts: ['mastodon.social', 'mstdn.social', 'mastodon.online'],
    handleFrom: (url) => handleAt(url, 0, []),
    weight: 0.7,
  },
  {
    id: 'tumblr',
    label: 'Tumblr',
    hosts: ['tumblr.com'],
    weight: 0.65,
  },
  {
    id: 'vk',
    label: 'VK',
    hosts: ['vk.com'],
    handleFrom: (url) => handleAt(url, 0, ['wall', 'photo', 'video']),
    weight: 0.65,
  },
  {
    id: 'flickr',
    label: 'Flickr',
    hosts: ['flickr.com', 'staticflickr.com'],
    handleFrom: (url) => handleAt(url, 1, []),
    weight: 0.6,
  },
  {
    id: 'weibo',
    label: 'Weibo',
    hosts: ['weibo.com', 'weibo.cn'],
    weight: 0.6,
  },
  {
    id: 'snapchat',
    label: 'Snapchat',
    hosts: ['snapchat.com'],
    handleFrom: (url) => handleAt(url, 1, []),
    weight: 0.6,
  },
];

/** Strips a leading `www.` / `m.` so host comparisons behave predictably. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
}

export function parseUrlSafe(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function getDomain(value: string): string | undefined {
  const url = parseUrlSafe(value);
  return url ? normalizeHost(url.hostname) : undefined;
}

export function findPlatform(value: string): PlatformDefinition | undefined {
  const url = parseUrlSafe(value);
  if (!url) return undefined;
  const host = normalizeHost(url.hostname);
  return SOCIAL_PLATFORMS.find(
    (platform) =>
      platform.hosts.includes(host) ||
      platform.hosts.some((candidate) => host.endsWith(`.${candidate}`)),
  );
}

/** Human readable platform label, or undefined when the URL is not social. */
export function detectPlatform(value: string): string | undefined {
  return findPlatform(value)?.label;
}

export function isSocialUrl(value: string): boolean {
  return findPlatform(value) !== undefined;
}

/** Best-effort public handle (`@user`, `r/sub`) from a social post URL. */
export function extractHandle(value: string): string | undefined {
  const platform = findPlatform(value);
  const url = parseUrlSafe(value);
  if (!platform || !url || !platform.handleFrom) return undefined;
  const handle = platform.handleFrom(url);
  if (!handle) return undefined;
  // Reject things that are clearly ids rather than handles.
  if (/^@?\d{6,}$/.test(handle)) return undefined;
  return handle;
}

export function platformWeight(value: string): number {
  return findPlatform(value)?.weight ?? 0;
}
