'use client'

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import axios from "axios";

// Updated interface to match API response
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

export default function VriskoScraper() {
  const [url, setUrl] = useState<string>("");
  const [results, setResults] = useState<BusinessData[]>([]);
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
      const response = await axios.get<BusinessData[]>(`/api/scrape?url=${encodeURIComponent(url)}`);

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

  // Helper function to get full name
  const getFullName = (item: BusinessData): string => {
    if (item.surname && item.name) {
      return `${item.surname} ${item.name}`;
    }
    return item.surname || item.name || "Unknown";
  };

  // Helper function to get full address
  const getFullAddress = (item: BusinessData): string => {
    const parts = [
      item.address,
      item.city,
      item.postal_code,
      item.region
    ].filter(part => part && part.trim());
    
    return parts.length > 0 ? parts.join(", ") : "No address provided";
  };


  const handleDownloadCSV = () => {
    if (results.length === 0) {
      setError("No data available to download.");
      return;
    }
  
    const csvContent = [
      ["Surname", "Name", "Full Name", "Specialty", "Address", "City", "Postal Code", "Region", "Phone", "Mobile", "Email", "Website"],
      ...results.map((item) => [
        `"${(item.surname || "").replace(/"/g, '""')}"`,
        `"${(item.name || "").replace(/"/g, '""')}"`,
        `"${getFullName(item).replace(/"/g, '""')}"`,
        `"${(item.specialty || "").replace(/"/g, '""')}"`,
        `"${(item.address || "").replace(/"/g, '""')}"`,
        `"${(item.city || "").replace(/"/g, '""')}"`,
        `"${(item.postal_code || "").replace(/"/g, '""')}"`,
        `"${(item.region || "").replace(/"/g, '""')}"`,
        `"${(item.phone || "").replace(/"/g, '""')}"`,
        `"${(item.mobile || "").replace(/"/g, '""')}"`,
        `"${(item.email || "").replace(/"/g, '""')}"`,
        `"${(item.website || "").replace(/"/g, '""')}"`,
      ]),
    ]
    .map(row => row.join(","))
    .join("\n");
  
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `vrisko-scraped-data-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setSuccess("CSV file downloaded successfully!");
  };

  const handleClear = () => {
    setUrl("");
    setResults([]);
    setError("");
    setSuccess("");
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Vrisko.gr Business Scraper</h1>
      
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
              <TableHead className="font-bold">Full Name</TableHead>
              <TableHead className="font-bold">Specialty</TableHead>
              <TableHead className="font-bold">Address</TableHead>
              <TableHead className="font-bold">City</TableHead>
              <TableHead className="font-bold">Phone</TableHead>
              <TableHead className="font-bold">Mobile</TableHead>
              <TableHead className="font-bold">Email</TableHead>
              <TableHead className="font-bold">Website</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.length > 0 ? (
              results.map((item, index) => (
                <TableRow key={index} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <TableCell className="font-medium">{getFullName(item)}</TableCell>
                  <TableCell>{item.specialty || "Not specified"}</TableCell>
                  <TableCell>{getFullAddress(item)}</TableCell>
                  <TableCell>{item.city || "Not specified"}</TableCell>
                  <TableCell>
                    {item.phone ? (
                      <a 
                        href={`tel:${item.phone}`} 
                        className="text-blue-600 hover:underline"
                        title="Call this number"
                      >
                        {item.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not available</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.mobile ? (
                      <a 
                        href={`tel:${item.mobile}`} 
                        className="text-blue-600 hover:underline"
                        title="Call this mobile"
                      >
                        {item.mobile}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not available</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.email ? (
                      <a 
                        href={`mailto:${item.email}`} 
                        className="text-blue-600 hover:underline break-all"
                        title={`Email ${getFullName(item)}`}
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
                        {item.website.replace(/^https?:\/\//, '').substring(0, 40)}
                        {item.website.length > 40 ? "..." : ""}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not available</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
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

      {/* Summary section */}
      {results.length > 0 && (
        <div className="mt-4 p-3 bg-gray-50 rounded border">
          <h3 className="font-semibold text-sm mb-2">Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>Total Businesses: {results.length}</div>
            <div>With Email: {results.filter(r => r.email).length}</div>
            <div>With Website: {results.filter(r => r.website).length}</div>
            <div>With Phone: {results.filter(r => r.phone || r.mobile).length}</div>
          </div>
        </div>
      )}
    </div>
  );
}