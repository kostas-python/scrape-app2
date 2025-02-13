import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  
  puppeteer.use(StealthPlugin());

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid URL" });
  }

  console.log(`Scraping URL: ${url}`);

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    // Extract data
    const results = await page.evaluate(() => {
      const data: any[] = [];

      document.querySelectorAll(".AdvItemBox").forEach((el) => {
        const name = el.querySelector(".CompanyName a")?.textContent?.trim() || "";
        const address = el.querySelector(".AdvAddress")?.textContent?.trim() || "";
        const occupation = el.querySelector(".AdvCategory")?.textContent?.trim() || "";
        const email = el.querySelector(".AdvSiteEmailLink")?.textContent?.trim() || "";
        const website = el.querySelector(".urlClickLoggingClass")?.getAttribute("href") || "";

        data.push({ name, address, occupation, email, website });
      });

      return data;
    });

    console.log("Scraped Data:", results);

    await browser.close();
    return res.status(200).json(results);
  } catch (error) {
    console.error("Scraping error:", error);
    return res.status(500).json({ error: "Failed to scrape data" });
  }
}

