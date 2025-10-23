"use client";

import { useMemo, useState } from "react";

type UserRow = {
  login: string;
  name: string | null;
  profileUrl: string;
  emails: string[];
};

type ResultItem = {
  input: string;
  type: "user" | "org";
  users: UserRow[];
};

export default function Home() {
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const out: Array<{ source: string; kind: string; login: string; name: string | null; profileUrl: string; email: string }> = [];
    for (const r of data) {
      for (const u of r.users) {
        if (u.emails.length === 0) {
          out.push({ source: r.input, kind: r.type, login: u.login, name: u.name, profileUrl: u.profileUrl, email: "" });
        } else {
          for (const e of u.emails) {
            out.push({ source: r.input, kind: r.type, login: u.login, name: u.name, profileUrl: u.profileUrl, email: e });
          }
        }
      }
    }
    return out;
  }, [data]);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setData(null);

    const inputs = input
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!inputs.length) {
      setLoading(false);
      setError("Please enter at least one GitHub username or organization.");
      return;
    }

    try {
      const res = await fetch("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      setData(json.results as ResultItem[]);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function downloadCSV() {
    if (!rows.length) return;
    const header = ["source_input", "resolved_kind", "login", "name", "profile_url", "email"];
    const escape = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push([
        escape(r.source),
        escape(r.kind),
        escape(r.login),
        escape(r.name ?? ""),
        escape(r.profileUrl),
        escape(r.email)
      ].join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "github_emails.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen p-6 flex flex-col items-center bg-gray-50">
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-semibold mb-4">GitHub Email Finder</h1>
        <p className="text-sm text-gray-600 mb-4">
          Enter GitHub usernames or organization names (comma or newline separated).  
          The app tries commit author emails first. If that fails, it treats the input as an org, fetches members, and collects their commit emails (plus any public profile email).
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="octocat\nvercel\nmicrosoft"
          className="w-full h-36 p-3 border rounded-md bg-white"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={handleRun}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50"
          >
            {loading ? "Running…" : "Find Emails"}
          </button>
          <button
            onClick={downloadCSV}
            disabled={!rows.length}
            className="px-4 py-2 rounded-md border bg-white disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>

        {error && <div className="mt-4 text-red-600">{error}</div>}

        {!!data?.length && (
          <div className="mt-6 overflow-x-auto border rounded-md bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left p-2">Source Input</th>
                  <th className="text-left p-2">Kind</th>
                  <th className="text-left p-2">Login</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Profile</th>
                  <th className="text-left p-2">Emails</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) =>
                  r.users.map((u) => (
                    <tr key={`${r.input}:${u.login}`} className="border-t">
                      <td className="p-2">{r.input}</td>
                      <td className="p-2">{r.type}</td>
                      <td className="p-2">{u.login}</td>
                      <td className="p-2">{u.name ?? ""}</td>
                      <td className="p-2">
                        <a className="text-blue-600 underline" href={u.profileUrl} target="_blank" rel="noreferrer">
                          {u.profileUrl}
                        </a>
                      </td>
                      <td className="p-2">
                        {u.emails.length ? u.emails.join(", ") : <span className="text-gray-500">Not public / not found</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          Note: Many users keep emails private or use <code>noreply</code> addresses in commits. Results are best-effort and limited by GitHub API rate limits and visibility.
        </div>
      </div>
    </main>
  );
}
