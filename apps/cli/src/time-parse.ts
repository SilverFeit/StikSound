import { CliInputError } from "./errors";

/**
 * Parses a human-friendly time expression into non-negative integer milliseconds:
 * - plain integer or decimal ms: `"1500"`, `"1500ms"` -> 1500
 * - seconds: `"1.5s"`, `"5s"` -> 1500, 5000
 * - minutes:seconds: `"0:05"`, `"1:02.5"` -> 5000, 62500
 */
export function parseTimeToMs(raw: string, label: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    throw new CliInputError(`${label} is empty.`);
  }

  // Plain integer milliseconds (e.g. "1500") or explicit "1500ms"
  const msMatch = /^(\d+(?:\.\d+)?)ms$/.exec(trimmed);
  if (msMatch) {
    const value = Math.round(Number(msMatch[1]));
    if (Number.isFinite(value) && value >= 0) return value;
  }

  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }

  // Seconds (e.g. "2.5s")
  const secMatch = /^(\d+(?:\.\d+)?)s$/.exec(trimmed);
  if (secMatch) {
    const value = Math.round(Number(secMatch[1]) * 1000);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  // MM:SS or MM:SS.sss (e.g. "0:05", "1:12.5")
  const clockMatch = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (clockMatch) {
    const minutes = Number(clockMatch[1]);
    const seconds = Number(clockMatch[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
      return Math.round((minutes * 60 + seconds) * 1000);
    }
  }

  throw new CliInputError(
    `Invalid ${label} "${raw}". Use milliseconds (e.g. 1500 or 1500ms), seconds (e.g. 1.5s), or mm:ss (e.g. 0:05).`
  );
}
