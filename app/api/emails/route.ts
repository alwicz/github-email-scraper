import { NextResponse } from "next/server";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// GitHub headers for commit search (historically required the 'cloak-preview' media type)
const baseHeaders: Record<string, string> = {
  "Accept": "application/vnd.github+json, application/vnd.github.cloak-preview+json",
  "User-Agent": "gh-email-finder"
};
if (GITHUB_TOKEN) baseHeaders["Authorization"] = `Bearer ${GITHUB_TOKEN}`;

// Simple sleep helper to be gentle with rate limits
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

type Input = { inputs: string[] };

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Input;
    const raw = (body.inputs || []).map(s => (s || "").trim()).filter(Boolean);

    // Process each input serially with tiny delays (safe for rate limits).
    const results: any[] = [];
    for (const name of raw) {
      const resolved = await resolveName(name);
      results.push(resolved);
      await sleep(150); // small backoff between top-level names
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

/**
 * Your workflow:
 * 1) Try commit search for `name` as a username.
 * 2) If it fails (HTTP != 200 or validation error / no items), treat as org:
 *    - fetch org members
 *    - for each member, fetch first commit email
 */
async function resolveName(name: string) {
  // Attempt commits for single user first
  const userEmail = await tryCommitEmail(name).catch(() => null);

  if (userEmail?.emails?.length) {
    return {
      input: name,
      type: "user",
      users: [{
        login: name,
        name: userEmail.name ?? null,
        profileUrl: `https://github.com/${name}`,
        emails: dedupe(userEmail.emails)
      }]
    };
  }

  // If no commit email found, try treating it as an org. If org check fails, still return as empty user.
  const isOrg = await checkIsOrg(name).catch(() => false);
  if (!isOrg) {
    // attempt to enrich with public profile email just in case
    const profile = await getUserProfile(name).catch(() => null);
    const profileEmail = profile?.email ? [profile.email] : [];
    return {
      input: name,
      type: "user",
      users: [{
        login: name,
        name: profile?.name ?? null,
        profileUrl: `https://github.com/${name}`,
        emails: dedupe(profileEmail)
      }]
    };
  }

  // Org branch
  const members = await getOrgMembers(name).catch(() => []);
  const users: any[] = [];

  // Process members with modest concurrency (safe & simple): batches of 5
  const batchSize = 5;
  for (let i = 0; i < members.length; i += batchSize) {
    const chunk = members.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map(async (m) => {
      // Try public profile first
      const profile = await getUserProfile(m.login).catch(() => null);
      const profileEmail = profile?.email ? [profile.email] : [];

      // Then commits
      const commitResult = await tryCommitEmail(m.login).catch(() => null);
      const commitEmails = commitResult?.emails ?? [];

      return {
        login: m.login,
        name: profile?.name ?? null,
        profileUrl: `https://github.com/${m.login}`,
        emails: dedupe([...profileEmail, ...commitEmails])
      };
    }));
    users.push(...chunkResults);
    await sleep(250); // friendly gap between batches
  }

  return { input: name, type: "org", users };
}

/** Commit email finder (returns at most a couple unique emails; first page) */
async function tryCommitEmail(username: string): Promise<{ emails: string[], name?: string } | null> {
  const url = `https://api.github.com/search/commits?q=author:${encodeURIComponent(username)}&per_page=5&sort=author-date&order=desc`;
  const res = await fetch(url, { headers: baseHeaders });

  if (res.status === 422) {
    // validation failed = invalid search or user not found
    return null;
  }
  if (res.status === 403) {
    // rate limit or forbidden; bubble up so caller can decide
    throw new Error("GitHub API rate limit exceeded or forbidden (403). Add or rotate a token.");
  }
  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return null;

  const emails: string[] = [];
  let authorName: string | undefined;
  for (const it of items) {
    const email = it?.commit?.author?.email;
    if (email) emails.push(email);
    if (!authorName && it?.commit?.author?.name) authorName = it.commit.author.name;
  }
  return { emails: dedupe(emails), name: authorName };
}

async function checkIsOrg(name: string): Promise<boolean> {
  const url = `https://api.github.com/users/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: baseHeaders });
  if (!res.ok) return false;
  const data = await res.json();
  return data?.type === "Organization";
}

async function getUserProfile(username: string): Promise<{ name?: string; email?: string } | null> {
  const url = `https://api.github.com/users/${encodeURIComponent(username)}`;
  const res = await fetch(url, { headers: baseHeaders });
  if (!res.ok) return null;
  const data = await res.json();
  return { name: data?.name ?? undefined, email: data?.email ?? undefined };
}

async function getOrgMembers(org: string) {
  // paginate members
  const members: Array<{ login: string }> = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/members?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: baseHeaders });
    if (res.status === 404) break;
    if (res.status === 403) throw new Error("Org members forbidden or rate limited (403).");
    if (!res.ok) break;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const m of data) {
      if (m?.login) members.push({ login: m.login });
    }
    if (data.length < perPage) break;
    page++;
    await sleep(120);
  }

  return members;
}

function dedupe<T extends string>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
