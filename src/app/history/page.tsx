"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";

interface RunBrand {
  position: number;
  brand: { id: string; name: string };
}

interface Run {
  id: string;
  promptText: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  runBrands: RunBrand[];
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRuns() {
      try {
        const res = await apiFetch("/api/runs");
        if (res.ok) setRuns(await res.json());
      } catch {
        console.error("Failed to fetch runs");
      } finally {
        setLoading(false);
      }
    }
    fetchRuns();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Run History</h1>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          Loading runs...
        </div>
      ) : runs.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          No runs yet. Run a comparison from the home page.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Companies Compared</th>
                <th className="px-4 py-3">Prompt</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Results</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((run) => {
                const date = new Date(
                  run.completedAt || run.createdAt
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const brandNames = run.runBrands
                  .sort((a, b) => a.position - b.position)
                  .map((rb) => rb.brand.name)
                  .join(" vs ");
                const promptPreview =
                  run.promptText.length > 120
                    ? run.promptText.slice(0, 120) + "..."
                    : run.promptText;

                return (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {date}
                    </td>
                    <td className="px-4 py-3 font-medium">{brandNames}</td>
                    <td className="max-w-xs px-4 py-3 text-gray-600">
                      {promptPreview}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          run.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : run.status === "running"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/results/${run.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
