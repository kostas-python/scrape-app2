import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

interface BusinessData {
  name: string;
  address: string;
  occupation: string;
  email: string;
  website: string;
  phone: string;
}

// Cache for browser instance
let browserInstance: Browser | null = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({ 
      headless: true, // Fixed: changed from "new" to true
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

    // Optimize page performance
    await page.setRequestInterception(true);
    
    // Fixed: Added type annotation for the request parameter
    page.on('request', (req: any) => {
      // Block unnecessary resources
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

    // Batch process email URLs for better performance
    const processEmailBatch = async (results: BusinessData[]) => {
      const emailPromises = results.map(async (result, index) => {
        if (result.email.startsWith("EMAIL_URL:")) {
          const emailUrl = result.email.replace("EMAIL_URL:", "");
          if (emailUrl) {
            try {
              const emailPage = await browser.newPage();
              
              // Even more aggressive blocking for email pages
              await emailPage.setRequestInterception(true);
              
              // Fixed: Added type annotation
              emailPage.on('request', (req: any) => {
                if (['image', 'stylesheet', 'font', 'media', 'script'].includes(req.resourceType())) {
                  req.abort();
                } else {
                  req.continue();
                }
              });

              await emailPage.goto(emailUrl, { 
                waitUntil: 'domcontentloaded', // Faster than networkidle2
                timeout: 8000 
              });

              // Use Promise.race with timeout for email extraction
              const emailExtractionPromise = emailPage.evaluate(() => {
                // Look for mailto links first (most common)
                const mailtoLink = document.querySelector("a[href^='mailto:']");
                if (mailtoLink) {
                  return mailtoLink.getAttribute("href")?.replace("mailto:", "").trim() || "";
                }
                
                // Look for email in text content
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
              console.error(`Failed to fetch email for ${result.name}:`, error);
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
          waitUntil: "domcontentloaded", // Much faster than networkidle2
          timeout: 15000 
        });

        // Wait for selector with shorter timeout
        try {
          await page.waitForSelector(".AdvItemBox, .LightAdvItemBox, .FreeListingItemBox", { 
            timeout: 5000 
          });
        } catch {
          console.warn("No business listings found on this page. Stopping.");
          break;
        }

        // Extract business data
        const results: BusinessData[] = await page.evaluate(() => {
          const extractEmail = (element: Element): string => {
            // Mailto links
            const mailtoLink = element.querySelector("a[href^='mailto:']");
            if (mailtoLink) {
              return mailtoLink.getAttribute("href")?.replace("mailto:", "").trim() || "";
            }
            
            // Email URL patterns
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
            
            return "";
          };

          const data: BusinessData[] = [];

          // Process all listing types in single loops
          const processElements = (selector: string, config: any) => {
            document.querySelectorAll(selector).forEach((el) => {
              const name = el.querySelector(config.name)?.textContent?.trim() || "";
              const address = el.querySelector(config.address)?.textContent?.trim() || "";
              const occupation = el.querySelector(config.occupation)?.textContent?.trim() || "";
              const email = extractEmail(el);
              const website = el.querySelector(config.website)?.getAttribute("href") || "";
              const phone = el.querySelector(config.phone)?.textContent?.trim() || "";

              if (name) { // Only add if we have at least a name
                data.push({ name, address, occupation, email, website, phone });
              }
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

        // Process emails in batches for current page results
        await processEmailBatch(results);

        allResults = [...allResults, ...results];

        // Check for next page
        nextPageUrl = await page.evaluate(() => { 
          const nextBtn = document.querySelector(".nextpage") as HTMLAnchorElement | null;
          return nextBtn ? nextBtn.href : null;
        });

        if (!nextPageUrl) {
          console.log("No more pages to scrape. Stopping.");
          break;
        }

        pageCount++;

        // Small delay between pages to be respectful
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