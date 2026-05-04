'use client'

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import axios from "axios";

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
type EnrichStatus = "idle" | "pending" | "found" | "not_found";
type ActiveTab = "scrape" | "upload";

interface EnrichState {
  status: EnrichStatus;
  email: string;
  layer: LayerName | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_META: Record<LayerName, { label: string; cls: string }> = {
  vrisko:      { label: "vrisko",   cls: "bg-blue-100 text-blue-700 border-blue-200" },
  website:     { label: "website",  cls: "bg-purple-100 text-purple-700 border-purple-200" },
  gemi:        { label: "GEMI",     cls: "bg-green-100 text-green-700 border-green-200" },
  google_maps: { label: "maps",     cls: "bg-orange-100 text-orange-700 border-orange-200" },
  facebook:    { label: "facebook", cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
};

// ─── Small components ─────────────────────────────────────────────────────────

function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function LayerBadge({ layer }: { layer: LayerName }) {
  const { label, cls } = LAYER_META[layer];
  return (
    <span className={`inline-block text-xs px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(raw: string): BusinessData[] {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  // Header: Surname,Name,Full Name,Specialty,Address,City,Postal Code,Region,Phone,Mobile,Email,Website
  return lines.slice(1).map(line => {
    const f = parseCSVLine(line);
    return {
      surname:     f[0]  ?? "",
      name:        f[1]  ?? "",
      specialty:   f[3]  ?? "",
      address:     f[4]  ?? "",
      city:        f[5]  ?? "",
      postal_code: f[6]  ?? "",
      region:      f[7]  ?? "",
      phone:       f[8]  ?? "",
      mobile:      f[9]  ?? "",
      email:       f[10] ?? "",
      website:     f[11] ?? "",
    };
  }).filter(r => r.surname || r.name);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VriskoScraper() {
  const [activeTab, setActiveTab]           = useState<ActiveTab>("scrape");
  const [url, setUrl]                       = useState("");
  const [results, setResults]               = useState<BusinessData[]>([]);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState("");
  const [success, setSuccess]               = useState("");
  const [enrichStates, setEnrichStates]     = useState<EnrichState[]>([]);
  const [enriching, setEnriching]           = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ completed: 0, total: 0 });
  const [csvDragOver, setCsvDragOver]       = useState(false);

  const foundEmailsRef     = useRef(new Map<number, string>());
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const getFullName = (item: BusinessData) => {
    if (item.surname && item.name) return `${item.surname} ${item.name}`;
    return item.surname || item.name || "Unknown";
  };

  const getFullAddress = (item: BusinessData) => {
    const parts = [item.address, item.city, item.postal_code, item.region].filter(p => p?.trim());
    return parts.length > 0 ? parts.join(", ") : "No address provided";
  };

  const resetEnrichment = () => {
    setEnrichStates([]);
    setEnrichProgress({ completed: 0, total: 0 });
    foundEmailsRef.current.clear();
  };

  // ── Scrape ──────────────────────────────────────────────────────────────────

  const handleScrape = async () => {
    if (!url.trim()) { setError("Please enter a valid Vrisko.gr link."); return; }
    if (!url.includes('vrisko.gr')) { setError("Please enter a valid Vrisko.gr domain URL."); return; }

    setLoading(true);
    setError("");
    setSuccess("");
    resetEnrichment();

    try {
      const response = await axios.get<BusinessData[]>(`/api/scrape?url=${encodeURIComponent(url)}`);
      if (response.data.length > 0) {
        setResults(response.data);
        setSuccess(`Successfully scraped ${response.data.length} entries!`);
      } else {
        setResults([]);
        setError("No results found. Try a different URL.");
      }
    } catch {
      setError("Failed to scrape data. Please check the URL and try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── CSV upload ──────────────────────────────────────────────────────────────

  const processCSVFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) { setError("No valid data found in the CSV file."); return; }
      setResults(parsed);
      resetEnrichment();
      setSuccess(`Loaded ${parsed.length} entries from CSV.`);
      setError("");
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleCSVDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setCsvDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) processCSVFile(file);
    else setError("Please drop a .csv file.");
  };

  const handleCSVFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processCSVFile(file);
  };

  // ── Enrich ──────────────────────────────────────────────────────────────────

  const handleEnrich = async (limit?: number) => {
    if (results.length === 0 || enriching) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    // Only enrich leads without an email
    const indicesToEnrich: number[] = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].email || !results[i].email.trim()) {
        indicesToEnrich.push(i);
      }
    }

    if (indicesToEnrich.length === 0) {
      setSuccess("All leads already have emails — nothing to enrich.");
      return;
    }

    // Apply limit to the filtered list, not the full results
    const effectiveTotal = limit
      ? Math.min(indicesToEnrich.length, limit)
      : indicesToEnrich.length;
    const targetIndices = indicesToEnrich.slice(0, effectiveTotal);
    const leadsToSend = targetIndices.map(i => results[i]);
    const serverIndexToOriginal = new Map<number, number>();
      targetIndices.forEach((originalIdx, serverIdx) => {
        serverIndexToOriginal.set(serverIdx, originalIdx);
      });

    foundEmailsRef.current.clear();
    setEnriching(true);
    setEnrichProgress({ completed: 0, total: effectiveTotal });

    // Initialize states: leads with existing emails stay "found", others become "pending"
    setEnrichStates(results.map((lead, i) => {
      if (lead.email && lead.email.trim()) {
        return { status: 'found', email: lead.email, layer: null } as EnrichState;
      }
      if (targetIndices.includes(i)) {
        return { status: 'pending', email: '', layer: null } as EnrichState;
      }
      return { status: 'idle', email: '', layer: null } as EnrichState;
    }));

    setError("");
    setSuccess("");

    const enrichUrl = limit ? `/api/enrich?limit=${limit}` : "/api/enrich";

    try {
      const response = await fetch(enrichUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToSend }),  // ← only send filtered leads
        signal: abortControllerRef.current.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const trimmed = chunk.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          let eventName = "";
          let dataStr = "";
          for (const line of trimmed.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;

          let data: Record<string, unknown>;
          try { data = JSON.parse(dataStr) as Record<string, unknown>; }
          catch { continue; }

          if (eventName === 'progress') {
            const serverIdx = data.leadIndex as number;
            const idx = serverIndexToOriginal.get(serverIdx);
          if (idx === undefined) continue;  // ← guard against stale events
            const layer  = data.layer as LayerName;
            const status = data.status as string;
            const email  = (data.email as string | undefined) ?? "";

            if (status === 'found') {
              // Pre-confirm found; result event will increment the counter
              setEnrichStates(prev => {
                const next = [...prev];
                next[idx] = { status: 'found', email, layer };
                return next;
              });
            } else if (layer === 'facebook') {
              // Last layer exhausted — no email
              setEnrichStates(prev => {
                const next = [...prev];
                next[idx] = { status: 'not_found', email: '', layer: null };
                return next;
              });
              setEnrichProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
            } else {
              // Still trying — update layer label shown next to spinner
              setEnrichStates(prev => {
                const next = [...prev];
                if (next[idx]?.status === 'pending') next[idx] = { ...next[idx], layer };
                return next;
              });
            }
          }

          if (eventName === 'result') {
            const serverIdx = data.leadIndex as number;
            const idx = serverIndexToOriginal.get(serverIdx);
          if (idx === undefined) continue;
            const email = data.email as string;
            foundEmailsRef.current.set(idx, email);
            setEnrichStates(prev => {
              const next = [...prev];
              next[idx] = { ...next[idx], status: 'found', email };
              return next;
            });
            setEnrichProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
          }

          if (eventName === 'done') {
            // Safety net: any still-pending row → not_found
            setEnrichStates(prev =>
              prev.map(s => s.status === 'pending' ? { ...s, status: 'not_found', layer: null } : s)
            );
            // Merge found emails into results so CSV download includes them
            const emailMap = new Map(foundEmailsRef.current);
            setResults(prev =>
              prev.map((r, i) => {
                const enriched = emailMap.get(i);
                return enriched ? { ...r, email: enriched } : r;
              })
            );
            setEnrichProgress(prev => ({ ...prev, completed: prev.total }));
            setSuccess(`${limit ? "Test" : "Enrichment"} complete — found ${data.found as number} email(s)${limit ? ` in first ${data.total as number}` : ""}.`);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[enrich]', err);
      setError('Email enrichment failed. Please try again.');
    } finally {
      setEnriching(false);
    }
  };

  // ── Download CSV ────────────────────────────────────────────────────────────

  const handleDownloadCSV = () => {
    if (results.length === 0) { setError("No data available to download."); return; }

    const csvContent = [
      ["Surname", "Name", "Full Name", "Specialty", "Address", "City", "Postal Code", "Region", "Phone", "Mobile", "Email", "Website"],
      ...results.map(item => [
        `"${(item.surname     || "").replace(/"/g, '""')}"`,
        `"${(item.name        || "").replace(/"/g, '""')}"`,
        `"${getFullName(item).replace(/"/g, '""')}"`,
        `"${(item.specialty   || "").replace(/"/g, '""')}"`,
        `"${(item.address     || "").replace(/"/g, '""')}"`,
        `"${(item.city        || "").replace(/"/g, '""')}"`,
        `"${(item.postal_code || "").replace(/"/g, '""')}"`,
        `"${(item.region      || "").replace(/"/g, '""')}"`,
        `"${(item.phone       || "").replace(/"/g, '""')}"`,
        `"${(item.mobile      || "").replace(/"/g, '""')}"`,
        `"${(item.email       || "").replace(/"/g, '""')}"`,
        `"${(item.website     || "").replace(/"/g, '""')}"`,
      ]),
    ]
      .map(row => row.join(','))
      .join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vrisko-scraped-data-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSuccess('CSV file downloaded successfully!');
  };

  // ── Clear ───────────────────────────────────────────────────────────────────

  const handleClear = () => {
    setUrl("");
    setResults([]);
    setError("");
    setSuccess("");
    resetEnrichment();
  };

  // ── Email cell ──────────────────────────────────────────────────────────────

  const renderEmailCell = (item: BusinessData, idx: number) => {
    const state = enrichStates[idx];

    if (state) {
      if (state.status === 'pending') {
        return (
          <div className="flex items-center gap-1.5 text-gray-400">
            <SpinnerIcon />
            {state.layer && (
              <span className="text-xs">{LAYER_META[state.layer]?.label ?? state.layer}…</span>
            )}
          </div>
        );
      }
      if (state.status === 'found') {
        return (
          <div className="flex flex-col gap-1">
            <a href={`mailto:${state.email}`} className="text-green-700 font-medium hover:underline text-sm break-all">
              {state.email}
            </a>
            {state.layer && <LayerBadge layer={state.layer} />}
          </div>
        );
      }
      if (state.status === 'not_found') {
        return (
          <span className="inline-block text-xs px-1.5 py-0.5 rounded border bg-gray-100 text-gray-500 border-gray-200">
            not found
          </span>
        );
      }
    }

    if (item.email) {
      return (
        <a href={`mailto:${item.email}`} className="text-blue-600 hover:underline break-all" title={`Email ${getFullName(item)}`}>
          {item.email}
        </a>
      );
    }
    return <span className="text-gray-400">Not available</span>;
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const pct = enrichProgress.total > 0
    ? Math.round((enrichProgress.completed / enrichProgress.total) * 100)
    : 0;

  const actionButtons = (
    <>
      {results.length > 0 && !loading && (
        <>
          <Button
            className="bg-violet-600 font-bold hover:bg-violet-700"
            onClick={() => handleEnrich()}
            disabled={enriching}
          >
            {enriching
              ? <span className="flex items-center gap-1.5"><SpinnerIcon className="text-white" />Enriching…</span>
              : "Enrich Emails"}
          </Button>
          <Button
            className="bg-amber-500 font-bold hover:bg-amber-600 text-white"
            onClick={() => handleEnrich(5)}
            disabled={enriching}
          >
            Test (5 leads)
          </Button>
        </>
      )}
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
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Vrisko.gr Business Scraper</h1>

      {/* Tabs */}
      <div className="flex border-b mb-4">
        {(["scrape", "upload"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setError(""); setSuccess(""); }}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === 'scrape' ? 'Scrape' : 'Upload CSV'}
          </button>
        ))}
      </div>

      {/* Scrape tab controls */}
      {activeTab === 'scrape' && (
        <div className="flex flex-col md:flex-row gap-2 mb-4 w-full">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScrape()}
            placeholder="https://www.vrisko.gr/search/..."
            className="flex-grow"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-green-700 font-bold hover:bg-green-800"
              onClick={handleScrape}
              disabled={loading}
            >
              {loading
                ? <span className="flex items-center gap-1.5"><SpinnerIcon className="text-white" />Scraping…</span>
                : "Scrape"}
            </Button>
            {actionButtons}
          </div>
        </div>
      )}

      {/* Upload CSV tab controls */}
      {activeTab === 'upload' && (
        <div className="mb-4">
          <div
            role="button"
            tabIndex={0}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              csvDragOver
                ? "border-green-500 bg-green-50"
                : "border-gray-300 hover:border-gray-400 bg-gray-50"
            }`}
            onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
            onDragLeave={() => setCsvDragOver(false)}
            onDrop={handleCSVDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <p className="text-gray-500 text-sm">
              Drop a <span className="font-medium">.csv</span> file here, or click to browse
            </p>
            <p className="text-gray-400 text-xs mt-1">Expects the column format exported by this tool</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCSVFileChange}
            />
          </div>

          {results.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {actionButtons}
            </div>
          )}
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
          {success}
        </div>
      )}

      {/* Enrichment progress bar */}
      {enrichProgress.total > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{enriching ? "Enriching emails…" : "Enrichment complete"}</span>
            <span>{enrichProgress.completed} / {enrichProgress.total} ({pct}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-violet-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Results count */}
      {results.length > 0 && (
        <div className="mb-2 text-sm text-gray-600">Showing {results.length} results</div>
      )}

      {/* Table */}
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
                    {item.phone
                      ? <a href={`tel:${item.phone}`} className="text-blue-600 hover:underline">{item.phone}</a>
                      : <span className="text-gray-400">Not available</span>}
                  </TableCell>
                  <TableCell>
                    {item.mobile
                      ? <a href={`tel:${item.mobile}`} className="text-blue-600 hover:underline">{item.mobile}</a>
                      : <span className="text-gray-400">Not available</span>}
                  </TableCell>
                  <TableCell>{renderEmailCell(item, index)}</TableCell>
                  <TableCell>
                    {item.website ? (
                      <a
                        href={item.website.startsWith('http') ? item.website : `https://${item.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline break-all"
                      >
                        {item.website.replace(/^https?:\/\//, '').substring(0, 40)}
                        {item.website.replace(/^https?:\/\//, '').length > 40 ? '…' : ''}
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
                    <div className="flex items-center justify-center gap-2">
                      <SpinnerIcon className="text-gray-500" />
                      Loading data…
                    </div>
                  ) : "No data available. Enter a Vrisko.gr URL and click Scrape, or upload a CSV."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
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
