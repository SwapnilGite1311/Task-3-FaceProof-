import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Splits a long hex string into fixed-width groups for readable display. */
export function groupHash(value: string, size = 8): string[] {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += size) groups.push(value.slice(i, i + size));
  return groups;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
