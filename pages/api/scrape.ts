import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, HTTPRequest } from 'puppeteer';

puppeteer.use(StealthPlugin());

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

// Cache for browser instance
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });
  }
  return browserInstance;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid URL" });
  }

  console.log(`Scraping URL: ${url}`);
  const startTime = Date.now();

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    
    // Fixed: Properly typed request handler
    page.on('request', (req: HTTPRequest) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1920, height: 1080 });

    let allResults: BusinessData[] = [];
    let nextPageUrl: string | null = url;
    let pageCount = 0;
    const maxPages = 10;

    // Batch process email URLs
    const processEmailBatch = async (results: BusinessData[]) => {
      const emailPromises = results.map(async (result, index) => {
        if (result.email.startsWith("EMAIL_URL:")) {
          const emailUrl = result.email.replace("EMAIL_URL:", "");
          if (emailUrl) {
            try {
              const emailPage = await browser.newPage();
              
              await emailPage.setRequestInterception(true);
              
              // Fixed: Properly typed request handler for email page
              emailPage.on('request', (req: HTTPRequest) => {
                if (['image', 'stylesheet', 'font', 'media', 'script'].includes(req.resourceType())) {
                  req.abort();
                } else {
                  req.continue();
                }
              });

              await emailPage.goto(emailUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 8000 
              });

              const emailExtractionPromise = emailPage.evaluate(() => {
                const mailtoLink = document.querySelector("a[href^='mailto:']");
                if (mailtoLink) {
                  return mailtoLink.getAttribute("href")?.replace("mailto:", "").trim() || "";
                }
                const bodyText = document.body.textContent || "";
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const matches = bodyText.match(emailRegex);
                return matches ? matches[0] : "";
              });

              const timeoutPromise = new Promise<string>((resolve) => 
                setTimeout(() => resolve(""), 3000)
              );

              const extractedEmail = await Promise.race([emailExtractionPromise, timeoutPromise]);
              
              await emailPage.close();
              return { index, email: extractedEmail || "" };
            } catch (error) {
              console.error(`Failed to fetch email for ${result.surname} ${result.name}:`, error);
              return { index, email: "" };
            }
          }
        }
        return { index, email: result.email };
      });

      const emailResults = await Promise.allSettled(emailPromises);
      emailResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results[result.value.index].email = result.value.email;
        }
      });
    };

    while (nextPageUrl && pageCount < maxPages) {
      console.log(`Scraping page ${pageCount + 1}: ${nextPageUrl}`);
      
      try {
        await page.goto(nextPageUrl, { 
          waitUntil: "domcontentloaded",
          timeout: 15000 
        });

        try {
          await page.waitForSelector(".AdvItemBox, .LightAdvItemBox, .FreeListingItemBox", { 
            timeout: 5000 
          });
        } catch {
          console.warn("No business listings found on this page. Stopping.");
          break;
        }

        const results: BusinessData[] = await page.evaluate(() => {

          const extractEmail = (element: Element): string => {
            const mailtoLink = element.querySelector("a[href^='mailto:']");
            if (mailtoLink) {
              return mailtoLink.getAttribute("href")?.replace("mailto:", "").trim() || "";
            }
            const emailLink = element.querySelector("a.emailClickLoggingClass[href*='/email/'], a.detailsMail[href*='/email/']");
            if (emailLink) {
              return `EMAIL_URL:${emailLink.getAttribute("href") || ""}`;
            }
            const emailElement = element.querySelector(".emailClickLoggingClass");
            if (emailElement) {
              const href = emailElement.getAttribute("href") || "";
              return href.includes("mailto:") ? 
                href.replace("mailto:", "").trim() : 
                `EMAIL_URL:${href}`;
            }
            const siteEmailLink = element.querySelector(".AdvSiteEmailLink a[href^='mailto:']");
            if (siteEmailLink) {
              return siteEmailLink.getAttribute("href")?.replace("mailto:", "").trim() || "";
            }
            const allText = element.textContent || "";
            const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) return emailMatch[0];
            return "";
          };

          const parseName = (raw: string): { surname: string; firstName: string } => {
            if (!raw) return { surname: "", firstName: "" };
            const cleaned = raw.trim();
            const parts = cleaned.split(/\s+/);
            if (parts.length === 1) return { surname: parts[0], firstName: "" };
            return { surname: parts[0], firstName: parts.slice(1).join(" ") };
          };

          const parseAddress = (raw: string): { street: string; city: string; postalCode: string; region: string } => {
            if (!raw) return { street: "", city: "", postalCode: "", region: "" };
            const parts = raw.split(",").map((p: string) => p.trim()).filter((p: string) => p);
            
            if (parts.length >= 4) {
              return { street: parts[0], city: parts[1], postalCode: parts[2], region: parts[3] };
            }
            if (parts.length === 3) {
              if (/^\d{4,5}$/.test(parts[2])) {
                return { street: parts[0], city: parts[1], postalCode: parts[2], region: "" };
              }
              return { street: parts[0], city: parts[1], postalCode: "", region: parts[2] };
            }
            if (parts.length === 2) {
              return { street: parts[0], city: parts[1], postalCode: "", region: "" };
            }
            return { street: raw.trim(), city: "", postalCode: "", region: "" };
          };

          const parsePhones = (rawPhone: string, element: Element): { phone: string; mobile: string } => {
            const numbers: string[] = [];

            if (rawPhone) {
              const cleaned = rawPhone.replace(/\s+/g, "").trim();
              if (cleaned.length >= 10) numbers.push(cleaned);
            }

            element.querySelectorAll(".DetailsText").forEach((dt) => {
              const text = dt.textContent?.replace(/\s+/g, "").trim() || "";
              if (/^[26]\d{9,}$/.test(text) && !numbers.includes(text)) {
                numbers.push(text);
              }
            });

            const phoneData = element.querySelector("[data-phone]");
            if (phoneData) {
              const dp = phoneData.getAttribute("data-phone")?.replace(/\s+/g, "").trim() || "";
              if (dp.length >= 10 && !numbers.includes(dp)) numbers.push(dp);
            }

            let phone = "";
            let mobile = "";
            for (const num of numbers) {
              const digits = num.replace(/\D/g, "");
              if (digits.startsWith("69") && !mobile) {
                mobile = num;
              } else if (digits.startsWith("2") && !phone) {
                phone = num;
              } else if (!phone) {
                phone = num;
              } else if (!mobile) {
                mobile = num;
              }
            }

            return { phone, mobile };
          };

          const cleanWebsite = (href: string): string => {
            if (!href) return "";
            let url = href.trim();
            if (url.startsWith("javascript:")) return "";
            try {
              if (url.includes("redirect") || url.includes("/click/")) {
                const parsed = new URL(url);
                const realUrl = parsed.searchParams.get("url") || parsed.searchParams.get("u") || url;
                url = realUrl;
              }
            } catch {}
            if (url.startsWith("www.")) url = "https://" + url;
            if (!url.startsWith("http")) return "";
            return url;
          };

          const data: BusinessData[] = [];

          const processElements = (selector: string, config: {
            name: string; address: string; occupation: string; website: string; phone: string;
          }) => {
            document.querySelectorAll(selector).forEach((el) => {
              const rawName = el.querySelector(config.name)?.textContent?.trim() || "";
              const rawAddress = el.querySelector(config.address)?.textContent?.trim() || "";
              const rawOccupation = el.querySelector(config.occupation)?.textContent?.trim() || "";
              const rawPhone = el.querySelector(config.phone)?.textContent?.trim() || "";
              const rawWebsiteHref = el.querySelector(config.website)?.getAttribute("href") || "";

              if (!rawName) return;

              const { surname, firstName } = parseName(rawName);
              const { street, city, postalCode, region } = parseAddress(rawAddress);
              const { phone, mobile } = parsePhones(rawPhone, el);
              const email = extractEmail(el);
              const website = cleanWebsite(rawWebsiteHref);

              data.push({
                surname,
                name: firstName,
                specialty: rawOccupation,
                address: street,
                city,
                postal_code: postalCode,
                region,
                phone,
                mobile,
                email,
                website,
              });
            });
          };

          processElements(".AdvItemBox", {
            name: ".CompanyName a",
            address: ".AdvAddress",
            occupation: ".AdvCategory",
            website: ".urlClickLoggingClass",
            phone: ".phoneHidden"
          });

          processElements(".LightAdvItemBox", {
            name: ".CompanyName a",
            address: ".LightAdvAddress",
            occupation: ".LightAdvCategoryArea .AdvCategory",
            website: ".DetailsText a[rel='nofollow']",
            phone: ".DetailsText[itemprop='telephone']"
          });

          processElements(".FreeListingItemBox", {
            name: ".CompanyName a",
            address: ".AdvAddress",
            occupation: ".AdvCategory",
            website: ".urlClickLoggingClass",
            phone: ".DetailsText[itemprop='telephone'], .phoneHidden"
          });

          return data;
        });

        if (results.length === 0) {
          console.warn("No results found on this page. Ending pagination.");
          break;
        }

        await processEmailBatch(results);
        allResults = [...allResults, ...results];

        nextPageUrl = await page.evaluate(() => { 
          const nextBtn = document.querySelector(".nextpage") as HTMLAnchorElement | null;
          return nextBtn ? nextBtn.href : null;
        });

        if (!nextPageUrl) {
          console.log("No more pages to scrape. Stopping.");
          break;
        }

        pageCount++;
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (pageError) {
        console.error(`Error scraping page ${pageCount + 1}:`, pageError);
        break;
      }
    }

    const endTime = Date.now();
    console.log(`Scraping completed in ${(endTime - startTime) / 1000} seconds`);
    console.log(`Total Scraped Entries: ${allResults.length}`);

    return res.status(200).json(allResults);

  } catch (err) {
    console.error("Scraping error:", err);
    return res.status(500).json({ error: "Failed to scrape data" });
  }
}

// Cleanup browser on process exit
process.on('beforeExit', async () => {
  if (browserInstance) {
    await browserInstance.close();
  }
});