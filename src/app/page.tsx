'use client'

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import axios from "axios";

interface ScrapedData {
  name: string;
  address: string;
  occupation: string;
  email: string;
  website: string;
  phone: string;
}

export default function VriskoScraper() {
  const [url, setUrl] = useState<string>("");
  const [results, setResults] = useState<ScrapedData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const handleScrape = async () => {
    if (!url.trim()) {
      setError("Please enter a valid Vrisko.gr link.");
      return;
    }

    // Basic URL validation
    if (!url.includes('vrisko.gr')) {
      setError("Please enter a valid Vrisko.gr domain URL.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      console.log("Scraping started...");
      const response = await axios.get<ScrapedData[]>(`/api/scrape?url=${encodeURIComponent(url)}`);

      console.log("Scraping response:", response.data);

      if (response.data.length > 0) {
        setResults(response.data);
        setSuccess(`Successfully scraped ${response.data.length} entries!`);
      } else {
        setResults([]);
        setError("No results found. Try a different URL.");
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to scrape data. Please check the URL and try again.");
    } finally {
      setLoading(false);
    }
  };


  const handleDownloadCSV = () => {
    if (results.length === 0) {
      setError("No data available to download.");
      return;
    }
  
    const csvContent = [
      ["Name", "Address", "Phone", "Occupation", "Email", "Website"],
      ...results.map(({ name, address, phone, occupation, email, website }) => 
        [
          `"${name.replace(/"/g, '""')}"`, 
          `"${address.replace(/"/g, '""')}"`, 
          `"${phone.replace(/"/g, '""')}"`, 
          `"${occupation.replace(/"/g, '""')}"`, 
          `"${email.replace(/"/g, '""')}"`, 
          `"${website.replace(/"/g, '""')}"`
        ]
      ),
    ]
    .map(row => row.join(","))
    .join("\n");
  
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `kommotiriaAigio${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClear = () => {
    setUrl("");
    setResults([]);
    setError("");
    setSuccess("");
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Vrisko.gr Scraper</h1>
      
      <div className="flex flex-col md:flex-row gap-2 mb-4 w-full">
        <Input 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          placeholder="https://www.vrisko.gr/search/..." 
          className="flex-grow"
        />
        <div className="flex gap-2">
          <Button 
            className="bg-green-700 font-bold hover:bg-green-800" 
            onClick={handleScrape} 
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Scraping...
              </span>
            ) : "Scrape"}
          </Button>
          <Button 
            className="font-bold bg-blue-600 hover:bg-blue-700" 
            onClick={handleDownloadCSV} 
            disabled={results.length === 0}
          >
            Download CSV
          </Button>
          <Button 
            className="bg-red-500 text-white font-bold hover:bg-red-600" 
            onClick={handleClear} 
            variant="secondary"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          {success}
        </div>
      )}

      {/* Results count */}
      {results.length > 0 && (
        <div className="mb-2 text-sm text-gray-600">
          Showing {results.length} results
        </div>
      )}

      {/* Scraped data table */}
      <div className="overflow-x-auto">
        <Table className="border">
          <TableHeader className="bg-gray-100">
            <TableRow>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Address</TableHead>
              <TableHead className="font-bold">Phone</TableHead>
              <TableHead className="font-bold">Occupation</TableHead>
              <TableHead className="font-bold">Email</TableHead>
              <TableHead className="font-bold">Website</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.length > 0 ? (
              results.map((item, index) => (
                <TableRow key={index} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.address}</TableCell>
                  <TableCell>{item.phone}</TableCell>
                  <TableCell>{item.occupation}</TableCell>
                  <TableCell>
                    {item.email ? (
                      <a 
                        href={`mailto:${item.email}`} 
                        className="text-blue-600 hover:underline break-all"
                        title={`Email ${item.name}`}
                      >
                        {item.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not available</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.website ? (
                      <a 
                        href={item.website.startsWith('http') ? item.website : `https://${item.website}`}
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:underline break-all"
                        title="Visit website"
                      >
                        {item.website.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not available</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading data...
                    </div>
                  ) : "No data available. Enter a Vrisko.gr URL and click Scrape."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}