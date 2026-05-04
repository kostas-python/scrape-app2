import type { Browser, HTTPRequest, Page } from "puppeteer";
import { extractEmail, extractAllEmails, pickBestEmail } from "./emailUtils";

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

/**
 * GEMI (Γ.Ε.ΜΗ.) — Greek General Commercial Registry.
 * Every registered Greek business is legally required to list contact info
 * including email. Coverage approaches 100% for incorporated entities
 * (sole proprietors not always present).
 *
 * Public search: https://publicity.businessportal.gr
 *
 * Note: the portal occasionally changes its DOM and rate-limits aggressive
 * scraping. We treat it as best-effort and fail silently.
 */
export async function tryGEMI(lead: BusinessData, browser: Browser): Promise<string> {
  // GEMI search works best with the business/owner full name
  const query = [lead.surname, lead.name].filter(Boolean).join(" ").trim();
  if (!query) return "";

  const page = await browser.newPage();

  try {
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
    await page.setExtraHTTPHeaders({ "Accept-Language": "el-GR,el;q=0.9,en;q=0.8" });

    const searchUrl = `https://publicity.businessportal.gr/search?q=${encodeURIComponent(query)}`;

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      return "";
    }

    // Wait briefly for results table — GEMI renders client-side in places
    await new Promise<void>((r) => setTimeout(r, 1500));

    // ── Strategy A: email visible directly in search results ─────────────
    const directEmail = await scanCurrentPage(page);
    if (directEmail) return directEmail;

    // ── Strategy B: click through to first result detail page ────────────
    const resultLink = await page.evaluate(() => {
      // Try common result selectors — GEMI's portal layout varies
      const selectors = [
        "table tbody tr td a[href*='/company/']",
        ".results a[href*='/company/']",
        "a[href*='/company/']",
        "a[href*='/details/']",
      ];
      for (const sel of selectors) {
        const link = document.querySelector<HTMLAnchorElement>(sel);
        if (link?.href) return link.href;
      }
      return "";
    });

    if (!resultLink) return "";

    try {
      await page.goto(resultLink, { waitUntil: "domcontentloaded", timeout: 12000 });
      await new Promise<void>((r) => setTimeout(r, 1000));
    } catch {
      return "";
    }

    return scanCurrentPage(page, lead);
  } catch (err) {
    console.error("[gemi] error:", err);
    return "";
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Scan the current page for emails — checks mailto links, label-paired
 * fields, and falls back to body-text regex.
 */
async function scanCurrentPage(
  page: Page,
  lead?: BusinessData
): Promise<string> {
  const data = await page.evaluate(() => {
    // Mailto first
    const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
    const mailtoEmail = mailto ? mailto.href.replace(/^mailto:/i, "").split("?")[0].trim() : "";

    // Look for label/value pairs — GEMI uses dt/dd or table rows
    let labelEmail = "";
    const rows = document.querySelectorAll("tr, .field, .info-row, dl > *");
    for (const row of Array.from(rows)) {
      const text = row.textContent ?? "";
      if (/email|e-?mail|ηλεκτρ.*ταχυδρ|ηλεκτρονική.*διεύθυνση/i.test(text)) {
        const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        if (match) {
          labelEmail = match[0];
          break;
        }
      }
    }

    return {
      mailtoEmail,
      labelEmail,
      bodyText: document.body?.textContent ?? "",
    };
  });

  if (data.mailtoEmail) {
    const valid = extractEmail(data.mailtoEmail);
    if (valid) return valid;
  }

  if (data.labelEmail) {
    const valid = extractEmail(data.labelEmail);
    if (valid) return valid;
  }

  const bodyEmails = extractAllEmails(data.bodyText);
  return pickBestEmail(bodyEmails, lead);
}