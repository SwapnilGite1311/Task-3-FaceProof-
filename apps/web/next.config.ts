import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin tracing to the monorepo root; without it Next can pick up an unrelated
  // lockfile higher up the filesystem and warn on every build.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // The shared package ships compiled CJS; Next still needs to bundle it.
  transpilePackages: ['@faceproof/shared'],
  poweredByHeader: false,
  // Hides the floating "N" dev-tools badge in the corner. It is dev-only and
  // harmless, but it has no place in a demo recording or a screenshot.
  devIndicators: false,
  eslint: {
    // Candidate thumbnails come from arbitrary third-party CDNs that cannot be
    // enumerated in next.config, so plain <img> is used deliberately.
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
