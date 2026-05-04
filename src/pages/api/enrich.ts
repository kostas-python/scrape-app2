import type { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, HTTPRequest } from "puppeteer";
import { tryWebsiteEnhanced } from "@/lib/enrichment/websiteEnhanced";
import { tryGEMI } from "@/lib/enrichment/gemiLayer";

puppeteer.use(StealthPlugin());

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

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

type LayerName = "vrisko" | "website" | "gemi" | "google_maps" | "facebook";
type LayerStatus = "found" | "not_found" | "error";

interface ProgressEvent {
  leadIndex: number;
  layer: LayerName;
  status: LayerStatus;
  email?: string;
}

interface ResultEvent {
  leadIndex: number;
  email: string;
}

interface DoneEvent {
  total: number;
  found: number;
}

interface ErrorEvent {
  message: string;
}

// ─── Browser singleton (separate from scrape.ts getBrowser) ───────────────────

let enrichBrowserInstance: Browser | null = null;

async function getEnrichBrowser(): Promise<Browser> {
  if (enrichBrowserInstance?.connected) return enrichBrowserInstance;

  enrichBrowserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  enrichBrowserInstance.on("disconnected", () => {
    enrichBrowserInstance = null;
  });

  return enrichBrowserInstance;
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

async function withPage<T>(
  browser: Browser,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const page = await browser.newPage();

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

  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

// Passed into page.evaluate() as a string to avoid serialisation of RegExp.
const EMAIL_RE =
  "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}";

// ─── Layer 1: vrisko.gr ───────────────────────────────────────────────────────

async function tryVrisko(lead: BusinessData, browser: Browser): Promise<string> {
  const query = [lead.surname, lead.name, lead.specialty, lead.city]
    .filter(Boolean)
    .join(" ");

  return withPage(browser, async (page) => {
    const searchUrl = `https://www.vrisko.gr/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 12000 });

    const raw = await page.evaluate((re: string) => {
      const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
      if (mailto) return mailto.href.replace("mailto:", "").trim();

      const emailLink = document.querySelector<HTMLAnchorElement>(
        "a.emailClickLoggingClass[href*='/email/'], a.detailsMail[href*='/email/']"
      );
      if (emailLink?.href) return `EMAIL_URL:${emailLink.href}`;

      // NEW: check for the AJAX email form action — newer vrisko listings use this
      const emailForm = document.querySelector<HTMLFormElement>(
        "form#EmailForm[action*='/email/'], form[action*='/EmailCompany/']"
      );
      if (emailForm?.action) {
        return `EMAIL_URL:${emailForm.action}`;
      }

      const text = document.body.textContent ?? "";
      const m = text.match(new RegExp(re));
      return m ? m[0] : "";
    }, EMAIL_RE);

    if (!raw.startsWith("EMAIL_URL:")) return raw;

    // Resolve obfuscated email redirect (same pattern as scrape.ts)
    const emailUrl = raw.replace("EMAIL_URL:", "");
    return withPage(browser, async (emailPage) => {
      await emailPage.setRequestInterception(true);
      emailPage.on("request", (req: HTTPRequest) => {
        if (["image", "stylesheet", "font", "media", "script"].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
      try {
        await emailPage.goto(emailUrl, { waitUntil: "domcontentloaded", timeout: 8000 });
        return emailPage.evaluate((re: string) => {
          const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
          if (mailto) return mailto.href.replace("mailto:", "").trim();
          const m = (document.body.textContent ?? "").match(new RegExp(re));
          return m ? m[0] : "";
        }, EMAIL_RE);
      } catch {
        return "";
      }
    });
  });
}

// ─── Layer 2: business website ────────────────────────────────────────────────

async function tryWebsite(lead: BusinessData, browser: Browser): Promise<string> {
  if (!lead.website) return "";

  const base = lead.website.startsWith("http")
    ? lead.website
    : `https://${lead.website}`;

  return withPage(browser, async (page) => {
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 12000 });
    } catch {
      return "";
    }

    const { email: direct, contactHref } = await page.evaluate((re: string) => {
      const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
      if (mailto) return { email: mailto.href.replace("mailto:", "").trim(), contactHref: "" };

      const m = (document.body.textContent ?? "").match(new RegExp(re));
      if (m) return { email: m[0], contactHref: "" };

      const anchor = document.querySelector<HTMLAnchorElement>(
        "a[href*='contact'], a[href*='επικοιν'], a[href*='contact-us']"
      );
      return { email: "", contactHref: anchor?.href ?? "" };
    }, EMAIL_RE);

    if (direct) return direct;
    if (!contactHref) return "";

    // Navigate same page to contact sub-page
    try {
      await page.goto(contactHref, { waitUntil: "domcontentloaded", timeout: 10000 });
      return page.evaluate((re: string) => {
        const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
        if (mailto) return mailto.href.replace("mailto:", "").trim();
        const m = (document.body.textContent ?? "").match(new RegExp(re));
        return m ? m[0] : "";
      }, EMAIL_RE);
    } catch {
      return "";
    }
  });
}

// ─── Layer 3: Google Maps ─────────────────────────────────────────────────────

async function tryGoogleMaps(lead: BusinessData, browser: Browser): Promise<string> {
  const query = [lead.surname, lead.name, lead.specialty, lead.city]
    .filter(Boolean)
    .join(" ");

  return withPage(browser, async (page) => {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector(".Nv2PK, .hfpxzc", { timeout: 6000 });
    } catch {
      return "";
    }

    // Click first result to open the detail panel
    const clicked = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".Nv2PK a, .hfpxzc");
      el?.click();
      return Boolean(el);
    });

    if (!clicked) return "";

    try {
      await page.waitForSelector('[data-item-id="authority"], .rogA2c, .CsEnBe', {
        timeout: 6000,
      });
    } catch {
      // Panel may still have loaded
    }

    await new Promise<void>((r) => setTimeout(r, 800));

    return page.evaluate((re: string) => {
      const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
      if (mailto) return mailto.href.replace("mailto:", "").trim();
      const m = (document.body.textContent ?? "").match(new RegExp(re));
      return m ? m[0] : "";
    }, EMAIL_RE);
  });
}

// ─── Layer 4: Facebook ────────────────────────────────────────────────────────

async function tryFacebook(lead: BusinessData, browser: Browser): Promise<string> {
  const query = [lead.surname, lead.name, lead.city].filter(Boolean).join(" ");

  return withPage(browser, async (page) => {
    const searchUrl = `https://www.facebook.com/search/pages/?q=${encodeURIComponent(query)}`;

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      return "";
    }

    const gated = await page.evaluate(() =>
      Boolean(
        document.querySelector("#login_form") ||
        document.querySelector('[data-testid="royal_login_button"]')
      )
    );

    if (gated) {
      // Facebook requires login — last-ditch regex scan on whatever rendered
      return page.evaluate((re: string) => {
        const m = (document.body.textContent ?? "").match(new RegExp(re));
        return m ? m[0] : "";
      }, EMAIL_RE);
    }

    const pageHref = await page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>(
        'a[href*="facebook.com/"]:not([href*="search"])'
      );
      return a?.href ?? "";
    });

    if (!pageHref) return "";

    try {
      await page.goto(`${pageHref}/about`, { waitUntil: "domcontentloaded", timeout: 12000 });
      return page.evaluate((re: string) => {
        const mailto = document.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
        if (mailto) return mailto.href.replace("mailto:", "").trim();
        const m = (document.body.textContent ?? "").match(new RegExp(re));
        return m ? m[0] : "";
      }, EMAIL_RE);
    } catch {
      return "";
    }
  });
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

type LayerFn = (lead: BusinessData, browser: Browser) => Promise<string>;

const LAYERS: ReadonlyArray<{ name: LayerName; fn: LayerFn }> = [
  { name: "website",     fn: tryWebsiteEnhanced },
  { name: "gemi",        fn: tryGEMI },
  { name: "vrisko",      fn: tryVrisko },
  { name: "google_maps", fn: tryGoogleMaps },
  { name: "facebook",    fn: tryFacebook },
];

async function enrichLead(
  lead: BusinessData,
  leadIndex: number,
  browser: Browser,
  onProgress: (e: ProgressEvent) => void
): Promise<string> {
  for (const { name, fn } of LAYERS) {
    let email = "";
    let status: LayerStatus = "not_found";

    try {
      email = await fn(lead, browser);
      status = email ? "found" : "not_found";
    } catch (err) {
      status = "error";
      console.error(`[enrich] layer=${name} leadIndex=${leadIndex}`, err);
    }

    onProgress({ leadIndex, layer: name, status, ...(email ? { email } : {}) });

    if (email) return email;
  }

  return "";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { leads } = req.body as { leads?: unknown };
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: "leads must be a non-empty array" });
    return;
  }
  const typedLeads = leads as BusinessData[];

  const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
  const queueSize = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, typedLeads.length)
    : typedLeads.length;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let aborted = false;
  req.on("close", () => { aborted = true; });

  function send(event: string, data: ProgressEvent | ResultEvent | DoneEvent | ErrorEvent): void {
    if (!aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Keep proxy/load-balancer connections alive
  const heartbeat = setInterval(() => {
    if (!aborted) res.write(": heartbeat\n\n");
  }, 25_000);

  let foundCount = 0;

  try {
    const browser = await getEnrichBrowser();

    // Simple concurrent queue — JS single-thread ensures shift() is race-free
    const queue: number[] = typedLeads.map((_, i) => i).slice(0, queueSize);

    async function worker(): Promise<void> {
      while (!aborted) {
        const index = queue.shift();
        if (index === undefined) break;

        const email = await enrichLead(
          typedLeads[index],
          index,
          browser,
          (e) => send("progress", e)
        );

        if (email) {
          foundCount++;
          send("result", { leadIndex: index, email });
        }
      }
    }

    await Promise.all(Array.from({ length: 3 }, () => worker()));

    send("done", { total: queueSize, found: foundCount });
  } catch (err) {
    console.error("[enrich] fatal:", err);
    send("error", { message: String(err) });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

process.on("beforeExit", async () => {
  if (enrichBrowserInstance) {
    await enrichBrowserInstance.close();
  }
});
