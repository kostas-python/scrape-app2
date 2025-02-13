'use client'

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VriskoScraper() {
  const [url, setUrl] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleScrape = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/scrape?url=${encodeURIComponent(url)}`);
      setResults(response.data);
    } catch (error) {
      console.error("Error fetching data", error);
    }
    setLoading(false);
  };

  const handleDownloadCSV = () => {
    const csvContent = [
      ["Name", "Address", "Occupation", "Email", "Website"],
      ...results.map(item => [item.name, item.address, item.occupation, item.email, item.website])
    ]
    .map(row => row.join(","))
    .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "vrisko_data.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Vrisko.gr Scraper</h1>
      <div className="flex gap-2 mb-4">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter Vrisko.gr link..." />
        <Button onClick={handleScrape} disabled={loading}>{loading ? "Scraping..." : "Scrape"}</Button>
        <Button onClick={handleDownloadCSV} disabled={results.length === 0}>Download CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Occupation</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Website</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.name}</TableCell>
              <TableCell>{item.address}</TableCell>
              <TableCell>{item.occupation}</TableCell>
              <TableCell>{item.email}</TableCell>
              <TableCell>{item.website}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
