import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(() => {
      const items = document.querySelectorAll(".AdvItemBox");
      return Array.from(items).map(item => {
        const name = item.querySelector(".CompanyName a")?.textContent?.trim() || "";
        const address = item.querySelector(".AdvAddress")?.textContent?.trim() || "";
        const occupation = item.querySelector(".AdvCategory")?.textContent?.trim() || "";
        const email = item.querySelector(".AdvSiteEmailLink")?.textContent?.trim() || "";
        const website = item.querySelector(".urlClickLoggingClass")?.getAttribute("href") || "";
        return { name, address, occupation, email, website };
      });
    });

    await browser.close();
    res.status(200).json(data);
  } catch (error) {
    console.error("Scraping error:", error);
    res.status(500).json({ error: "Failed to scrape data" });
  }
}
