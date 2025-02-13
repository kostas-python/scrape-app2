import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// Define a type for the business data
interface BusinessData {
  name: string;
  address: string;
  occupation: string;
  email: string;
  website: string;
  phone: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid URL" });
  }

  console.log(`Scraping URL: ${url}`);

  try {
    const browser = await puppeteer.launch({ headless: true }); // or headless: false if debugging

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36");

    let allResults: BusinessData[] = [];
    let nextPageUrl: string | null = url;
    let pageCount = 0;

    while (nextPageUrl && pageCount < 10) { // Limit to 10 pages to prevent infinite loops
      console.log(`Scraping page: ${nextPageUrl}`);
      await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });

      // Wait for results to load but add a timeout to prevent infinite waiting
      try {
        await page.waitForSelector(".AdvItemBox, .LightAdvItemBox, .FreeListingItemBox", { timeout: 10000 });
      } catch {
        console.warn("No business listings found on this page. Stopping.");
        break; // Stop if no results are found (e.g., reached last page)
      }

      // Extract business data
      const results: BusinessData[] = await page.evaluate(() => {
        const data: BusinessData[] = [];

        // Extract from main listings (.AdvItemBox)
        document.querySelectorAll(".AdvItemBox").forEach((el) => {
          const name = el.querySelector(".CompanyName a")?.textContent?.trim() || "";
          const address = el.querySelector(".AdvAddress")?.textContent?.trim() || "";
          const occupation = el.querySelector(".AdvCategory")?.textContent?.trim() || "";
          const email = el.querySelector(".AdvSiteEmailLink")?.textContent?.trim() || "";
          const website = el.querySelector(".urlClickLoggingClass")?.getAttribute("href") || "";
          const phone = el.querySelector(".phoneHidden")?.textContent?.trim() || "";

          data.push({ name, address, occupation, email, website, phone });
        });

        // Extract from light listings (.LightAdvItemBox)
        document.querySelectorAll(".LightAdvItemBox").forEach((el) => {
          const name = el.querySelector(".CompanyName a")?.textContent?.trim() || "";
          const address = el.querySelector(".LightAdvAddress")?.textContent?.trim() || "";
          const occupation = el.querySelector(".LightAdvCategoryArea .AdvCategory")?.textContent?.trim() || "";
          const email = el.querySelector(".AdvSiteEmailLink")?.textContent?.trim() || "";
          const website = el.querySelector(".DetailsText a[rel='nofollow']")?.getAttribute("href") || "";
          const phone = el.querySelector(".DetailsText[itemprop='telephone']")?.textContent?.trim() || "";

          data.push({ name, address, occupation, email, website, phone });
        });

         // Extract from free listings (.FreeListingItemBox)
         document.querySelectorAll(".FreeListingItemBox").forEach((el) => {
            const name = el.querySelector(".CompanyName a")?.textContent?.trim() || "";
            const address = el.querySelector(".AdvAddress")?.textContent?.trim() || "";
            const occupation = el.querySelector(".AdvCategory")?.textContent?.trim() || "";
            const email = el.querySelector(".AdvSiteEmailLink")?.textContent?.trim() || "";
            const website = el.querySelector(".urlClickLoggingClass")?.getAttribute("href") || "";
            const phone = el.querySelector(".DetailsText[itemprop='telephone']")?.textContent?.trim() || 
                          el.querySelector(".phoneHidden")?.textContent?.trim() || "";
  
            data.push({ name, address, occupation, email, website, phone });
          });

        return data;
      });

      if (results.length === 0) {
        console.warn("No results found on this page. Ending pagination.");
        break;
      }

      allResults = [...allResults, ...results];

      // Find next page URL
      nextPageUrl = await page.evaluate(() => {
        const nextBtn = document.querySelector(".nextpage") as HTMLAnchorElement | null;
        return nextBtn ? nextBtn.href : null;
      });

      // Stops if there is no more pages
      if (!nextPageUrl) {
        console.log("No more pages to scrape. Stopping.");
        break;
      }

      pageCount++;
    }

    console.log(`Total Scraped Entries: ${allResults.length}`);

    await browser.close();
    return res.status(200).json(allResults);
  } catch (err) {
    console.error("Scraping error:", err);
    return res.status(500).json({ error: "Failed to scrape data" });
  }
}
