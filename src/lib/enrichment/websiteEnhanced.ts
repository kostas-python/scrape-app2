import type { Browser, Page, HTTPRequest } from "puppeteer";
import { extractAllEmails, pickBestEmail } from "./emailUtils";

interface BusinessData {
  surname: string;
  name: string;
  specialty: string;
  address: string;
  city: string;
  postal_code: string;
  region: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
}

const SUBPAGE_KEYWORDS = [
  // English
  "contact", "about", "imprint", "impressum", "privacy", "terms", "legal",
  "team", "staff",
  // Greek
  "επικοιν", "σχετικά", "ομάδα", "πολιτική", "όροι",
];

const SUBPAGE_PATHS = [
  "/contact", "/contact-us", "/about", "/about-us",
  "/imprint", "/impressum", "/privacy", "/privacy-policy",
  "/terms", "/legal", "/team",
  // Greek slugs commonly used
  "/epikoinonia", "/sxetika", "/oroi-xrisis", "/politiki-aporritou",
];

async function setupPage(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 800 });
}

interface PageScrape {
  bodyText: string;
  footerText: string;
  jsonLdEmails: string[];
  mailtoLinks: string[];
  subpageLinks: string[];
}

/**
 * Single evaluation pass that extracts everything we care about from a page.
 * Doing this in one round-trip is faster than multiple page.evaluate calls.
 */
async function scrapePageData(page: Page, baseUrl: string): Promise<PageScrape> {
  return page.evaluate((subpageKeywords: string[], origin: string) => {
    // Mailto links
    const mailtos = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='mailto:']"))
      .map((a) => a.href.replace(/^mailto:/i, "").split("?")[0].trim())
      .filter(Boolean);

    // JSON-LD structured data — schema.org Organization typically has email
    const jsonLdEmails: string[] = [];
    const ldScripts = document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]'
    );

    function walkForEmail(obj: unknown): void {
      if (!obj) return;
      if (typeof obj === "string") {
        if (obj.includes("@") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(obj)) {
          jsonLdEmails.push(obj);
        }
        return;
      }
      if (Array.isArray(obj)) {
        obj.forEach(walkForEmail);
        return;
      }
      if (typeof obj === "object") {
        Object.values(obj as Record<string, unknown>).forEach(walkForEmail);
      }
    }

    ldScripts.forEach((script) => {
      try {
        const parsed = JSON.parse(script.textContent ?? "");
        walkForEmail(parsed);
      } catch {
        // Malformed JSON-LD — skip
      }
    });

    // Footer text — emails often appear here for GDPR/contact reasons
    const footerEl = document.querySelector("footer, [class*='footer'], [id*='footer']");
    const footerText = footerEl?.textContent ?? "";

    const bodyText = document.body?.textContent ?? "";

    // Subpage candidates — anchors with relevant keywords
    const subpageLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((a) => a.href)
      .filter((href) => {
        try {
          const url = new URL(href, origin);
          if (url.origin !== origin) return false;
          const path = url.pathname.toLowerCase();
          return subpageKeywords.some((kw) => path.includes(kw));
        } catch {
          return false;
        }
      });

    return {
      bodyText,
      footerText,
      jsonLdEmails,
      mailtoLinks: mailtos,
      subpageLinks: Array.from(new Set(subpageLinks)),
    };
  }, SUBPAGE_KEYWORDS, new URL(baseUrl).origin);
}

function collectEmailsFromScrape(data: PageScrape): string[] {
  const emails: string[] = [];

  // Order matters for tie-breaking: structured data first, then mailto, then footer, then body
  emails.push(...data.jsonLdEmails);
  emails.push(...data.mailtoLinks);
  emails.push(...extractAllEmails(data.footerText));
  emails.push(...extractAllEmails(data.bodyText));

  return emails;
}

export async function tryWebsiteEnhanced(
  lead: BusinessData,
  browser: Browser
): Promise<string> {
  if (!lead.website) return "";

  const base = lead.website.startsWith("http")
    ? lead.website
    : `https://${lead.website}`;

  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    return "";
  }

  const page = await browser.newPage();

  try {
    await setupPage(page);

    const candidates: string[] = [];
    const visited = new Set<string>();

    // ── Step 1: homepage ─────────────────────────────────────────────────
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 12000 });
      visited.add(base);

      const homepageData = await scrapePageData(page, base);
      candidates.push(...collectEmailsFromScrape(homepageData));

      // Early exit if we have a high-quality match (mailto or JSON-LD)
      const earlyHit = pickBestEmail(
        [...homepageData.mailtoLinks, ...homepageData.jsonLdEmails].filter(Boolean),
        lead
      );
      if (earlyHit) return earlyHit;

      // Crawl up to 3 sub-pages found via anchor links
      const linksToVisit = homepageData.subpageLinks.slice(0, 3);
      for (const link of linksToVisit) {
        if (visited.has(link)) continue;
        visited.add(link);

        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout: 8000 });
          const subData = await scrapePageData(page, link);
          candidates.push(...collectEmailsFromScrape(subData));

          // Stop early if we found a strong mailto signal
          if (subData.mailtoLinks.length > 0) break;
        } catch {
          // Skip broken sub-pages
        }
      }
    } catch {
      // Homepage didn't load — fall through to direct path probing
    }

    // ── Step 2: probe common paths if homepage didn't yield ──────────────
    if (candidates.length === 0) {
      for (const path of SUBPAGE_PATHS.slice(0, 4)) {
        const url = `${baseOrigin}${path}`;
        if (visited.has(url)) continue;
        visited.add(url);

        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 6000 });
          const data = await scrapePageData(page, url);
          const found = collectEmailsFromScrape(data);
          if (found.length > 0) {
            candidates.push(...found);
            break;
          }
        } catch {
          // Path doesn't exist — keep probing
        }
      }
    }

    // ── Step 3: pick the best candidate ──────────────────────────────────
    const unique = Array.from(new Set(candidates.map((e) => e.toLowerCase().trim())));
    return pickBestEmail(unique, lead);
  } finally {
    await page.close().catch(() => undefined);
  }
}