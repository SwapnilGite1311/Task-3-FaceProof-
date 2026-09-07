/**
 * The API base URL is read at build time from NEXT_PUBLIC_API_URL. Every
 * browser-side request goes straight to the Fastify API, which is why the API
 * declares this origin in CORS_ORIGINS.
 */
const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const API_BASE_URL = raw.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
