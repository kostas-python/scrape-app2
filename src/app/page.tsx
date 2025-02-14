'use client'

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import axios from "axios";

// Define an interface to specify the expected structure of scraped data
interface ScrapedData {
  name: string;
  address: string;
  occupation: string;
  email: string;
  website: string;
  phone: string;
}

export default function VriskoScraper() {
  const [url, setUrl] = useState<string>(""); // State for input URL
  const [results, setResults] = useState<ScrapedData[]>([]); // Store scraped results
  const [loading, setLoading] = useState<boolean>(false); // Indicate loading state
  const [error, setError] = useState<string>(""); // Store error messages

  // Function to handle scraping
  const handleScrape = async () => {
    if (!url.trim()) {
      setError("Please enter a valid Vrisko.gr link.");
      return;
    }

    setLoading(true);
    setError(""); // Reset error message before fetching data

    try {
      console.log("Scraping started...");
      const response = await axios.get<ScrapedData[]>(`/api/scrape?url=${encodeURIComponent(url)}`);

      console.log("Scraping response:", response.data);

      if (response.data.length > 0) {
        setResults(response.data);
      } else {
        setResults([]);
        setError("No results found. Try a different URL.");
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to scrape data. Please check the URL and try again.");
    }

    setLoading(false);
  };

  // Function to handle CSV download
  const handleDownloadCSV = () => {
    if (results.length === 0) {
      setError("No data available to download.");
      return;
    }
  
    const csvContent = [
      ["Name", "Address", "Phone", "Occupation", "Email", "Website"], // CSV headers
      ...results.map(({ name, address, phone, occupation, email, website }) => 
        [
          `"${name}"`, 
          `"${address}"`, 
          `"${phone}"`, 
          `"${occupation}"`, 
          `"${email}"`, 
          `"${website}"`
        ]
      ),
    ]
    .map(row => row.join(",")) // Convert each row into a CSV string
    .join("\n"); // Join all rows with a newline
  
    // Create a downloadable CSV file
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" }); // UTF-8 BOM fixes encoding issues
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "odontiatroiThessaloniki.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  //Reset button function
  const handleClear = () => {
    setUrl(""); // Reset input field
    setResults([]); // Clear results
    setError(""); // Clear errors
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Tech4solutions Scraper</h1>
      
      <div className="flex gap-2 mb-4 w-[1500px]">
        <Input 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          placeholder="Enter Vrisko.gr link..." 
        />
        <Button className="bg-green-700 font-bold" onClick={handleScrape} disabled={loading}>
          {loading ? "Scraping..." : "Scrape"}
        </Button>
        <Button className="font-bold" onClick={handleDownloadCSV} disabled={results.length === 0}>
          Download CSV
        </Button>
        <Button className="bg-red-500 text-white font-bold" onClick={handleClear} variant="secondary">
          Clear
        </Button>
      </div>

      {/* Display error message if any */}
      {error && <p className="text-red-500 mb-4">{error}</p>}

      {/* Display scraped data in a table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Occupation</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Website</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.length > 0 ? (
            results.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.address}</TableCell>
                <TableCell>{item.phone}</TableCell>
                <TableCell>{item.occupation}</TableCell>
                <TableCell>{item.email}</TableCell>
                <TableCell>
                  <a href={item.website} target="_blank" rel="noopener noreferrer" className="text-blue-500">
                    {item.website}
                  </a>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="text-center">
                {loading ? "Scraping data..." : "No data available"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
