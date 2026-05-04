// ─── Shared email utilities ───────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Common false positives — image filenames, tracking pixels, platform noise
const BLOCKED_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "postmaster", "mailer-daemon", "abuse",
  "wixpress", "wix", "sentry",
]);

const BLOCKED_DOMAINS = new Set([
  "sentry.io", "sentry-next.wixpress.com",
  "wixpress.com", "wix.com",
  "example.com", "example.org", "domain.com",
  "test.com", "email.com",
]);

const BLOCKED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".css", ".js", ".woff", ".woff2", ".ttf",
];

/**
 * Validate an email candidate, filtering common false positives that show up
 * when regex-scraping page text (image filenames, platform tracking, etc).
 */
export function isValidEmail(candidate: string): boolean {
  if (!candidate) return false;
  const email = candidate.toLowerCase().trim();

  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return false;
  }

  const [localPart, domain] = email.split("@");

  if (BLOCKED_LOCAL_PARTS.has(localPart)) return false;
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (/^\d+$/.test(localPart)) return false;
  if (BLOCKED_EXTENSIONS.some((ext) => email.endsWith(ext))) return false;
  if (/@\d/.test(email)) return false; // e.g. "image@2x.png"
  if (localPart.length < 2 || localPart.length > 64) return false;

  return true;
}

/**
 * Deobfuscate emails written as "name [at] domain [dot] com",
 * "name(at)domain.com", HTML entities (&#64;), etc.
 */
export function deobfuscateText(text: string): string {
  return text
    .replace(/&#64;/gi, "@")
    .replace(/&#46;/gi, ".")
    .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".")
    // Greek variants
    .replace(/\s*\[\s*παπάκι\s*\]\s*/gi, "@")
    .replace(/\s*\[\s*τελεία\s*\]\s*/gi, ".");
}

/**
 * Extract the first valid email from arbitrary text.
 */
export function extractEmail(text: string): string {
  if (!text) return "";

  const cleaned = deobfuscateText(text);
  const matches = cleaned.match(EMAIL_REGEX);
  if (!matches) return "";

  for (const match of matches) {
    if (isValidEmail(match)) return match.toLowerCase().trim();
  }
  return "";
}

/**
 * Extract all valid emails from text (deduplicated).
 */
export function extractAllEmails(text: string): string[] {
  if (!text) return [];

  const cleaned = deobfuscateText(text);
  const matches = cleaned.match(EMAIL_REGEX);
  if (!matches) return [];

  const valid = matches
    .map((m) => m.toLowerCase().trim())
    .filter(isValidEmail);
  return Array.from(new Set(valid));
}

/**
 * Score an email by how likely it's the "real" business contact.
 * Higher = better. Used to pick from multiple candidates on a page.
 */
export function scoreEmail(email: string, lead?: { surname?: string; name?: string; website?: string }): number {
  const lower = email.toLowerCase();
  const [localPart, domain] = lower.split("@");
  let score = 0;

  // Domain matches business website → strong signal
  if (lead?.website) {
    const leadDomain = lead.website
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
    if (domain === leadDomain) score += 50;
  }

  // Local part contains person's name
  if (lead?.surname && localPart.includes(lead.surname.toLowerCase())) score += 20;
  if (lead?.name && localPart.includes(lead.name.toLowerCase())) score += 15;

  // Common business prefixes
  const businessPrefixes = ["info", "contact", "hello", "office", "mail"];
  if (businessPrefixes.includes(localPart)) score += 10;

  // Penalize generic free providers slightly (still valid, just less ideal for B2B)
  const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
  if (freeProviders.includes(domain)) score -= 5;

  // .gr domain bonus for Greek market
  if (domain.endsWith(".gr")) score += 5;

  return score;
}

/**
 * Pick the best email from a list of candidates.
 */
export function pickBestEmail(
  candidates: string[],
  lead?: { surname?: string; name?: string; website?: string }
): string {
  if (candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0];

  return candidates
    .map((email) => ({ email, score: scoreEmail(email, lead) }))
    .sort((a, b) => b.score - a.score)[0].email;
}