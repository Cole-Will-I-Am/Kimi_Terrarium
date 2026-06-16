// terrarium.manticthink.com — live monitor for the terrarium inhabitant.
// The VPS harness POSTs one event per wake cycle to /api/ingest (bearer-auth).
// The public read endpoints power the SEER-styled observatory UI in ./public.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Edge cache for the high-frequency read endpoints. The UI polls these every
// 4–20s, but the underlying data only changes once per wake (~30 min), so a
// short TTL collapses thousands of identical polls into one D1 hit per window,
// per colo — keeping read cost flat no matter how many viewers or how old the
// project gets. Only 200s are cached; keys include the query string.
async function edge(ctx, request, ttlSeconds, producer) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await producer();
  if (res.status === 200) {
    res.headers.set("cache-control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/ingest" && request.method === "POST") return ingest(request, env);
    if (pathname === "/api/events" && request.method === "GET") return edge(ctx, request, 15, () => listEvents(request, env));
    if (pathname === "/api/stats" && request.method === "GET") return edge(ctx, request, 20, () => stats(env));
    if (pathname === "/api/journal/ingest" && request.method === "POST") return journalIngest(request, env);
    if (pathname === "/api/journal" && request.method === "GET") return edge(ctx, request, 20, () => journalView(env));
    if (pathname === "/api/thoughts" && request.method === "GET") return edge(ctx, request, 15, () => thoughts(request, env));
    if (pathname === "/api/chat/ingest" && request.method === "POST") return chatIngest(request, env);
    if (pathname === "/api/chat" && request.method === "GET") return chatList(request, env);  // live feed — uncached
    if (pathname === "/api/milestones/ingest" && request.method === "POST") return milestoneIngest(request, env);
    if (pathname === "/api/milestones" && request.method === "GET") return edge(ctx, request, 60, () => milestoneList(request, env));
    if (pathname === "/api/steward/ingest" && request.method === "POST") return stewardIngest(request, env);
    if (pathname === "/api/steward" && request.method === "GET") return edge(ctx, request, 60, () => stewardList(request, env));
    if (pathname === "/api/oracle/ingest" && request.method === "POST") return oracleIngest(request, env);
    if (pathname === "/api/oracle" && request.method === "GET") return edge(ctx, request, 60, () => oracleList(request, env));
    if (pathname === "/api/council/ingest" && request.method === "POST") return councilIngest(request, env);
    if (pathname === "/api/council" && request.method === "GET") return edge(ctx, request, 60, () => councilList(request, env));
    if (pathname === "/api/canvas" && request.method === "GET") return edge(ctx, request, 30, () => canvasMeta(env));
    if ((pathname === "/kimi/raw" || pathname.startsWith("/kimi/raw/")) && request.method === "GET")
      return serveCanvas(env, pathname.slice(9));            // raw page (in the sandbox)
    if ((pathname === "/kimi" || pathname.startsWith("/kimi/")) && request.method === "GET")
      return kimiPage(pathname === "/kimi" ? "" : pathname.slice(6));  // wrapper
    if (pathname === "/feed.xml" && request.method === "GET") return edge(ctx, request, 300, () => rss(request, env));
    if (pathname.startsWith("/api/events/") && request.method === "GET")
      return edge(ctx, request, 300, () => oneEvent(env, pathname.split("/").pop()));  // a recorded cycle is ~immutable

    // everything else -> static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};

async function ingest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);

  let e;
  try {
    e = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (typeof e.cycle !== "number") return json({ error: "missing cycle" }, 400);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO cycles (
       cycle, thread_id, started_at, ended_at, duration_s, status, exit_code,
       summary, reasoning, commands_json, num_commands, files_json, num_files_changed,
       input_tokens, output_tokens, reasoning_tokens, chars_out, journal_excerpt,
       space_files_json, space_bytes, vitality, vitality_delta, cycle_effort, received_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      e.cycle, e.thread_id ?? null, e.started_at ?? null, e.ended_at ?? null,
      e.duration_s ?? null, e.status ?? null, e.exit_code ?? null,
      e.summary ?? null, e.reasoning ?? null,
      JSON.stringify(e.commands ?? []), e.num_commands ?? 0,
      JSON.stringify(e.files_changed ?? []), e.num_files_changed ?? 0,
      e.input_tokens ?? null, e.output_tokens ?? null, e.reasoning_tokens ?? null,
      e.chars_out ?? null, e.journal_excerpt ?? null,
      JSON.stringify(e.space_files ?? []), e.space_bytes ?? null,
      e.vitality ?? null, e.vitality_delta ?? null, e.cycle_effort ?? null,
      new Date().toISOString()
    )
    .run();

  // "Kimi's Page" — the inhabitant's self-authored public webpage. Stored as a
  // single row; updated whenever a cycle ships fresh HTML for it.
  // "Kimi's Page" — full set of self-authored pages (index.html is home).
  // Full-replace each ingest so deletions propagate.
  if (e.pages && typeof e.pages === "object" && !Array.isArray(e.pages)) {
    const now = new Date().toISOString();
    const entries = Object.entries(e.pages)
      .filter(([p, h]) => typeof p === "string" && typeof h === "string" && !p.includes(".."))
      .slice(0, 40);
    const stmts = [env.DB.prepare(`DELETE FROM pages`)];
    for (const [p, h] of entries)
      stmts.push(env.DB.prepare(`INSERT INTO pages (path, html, updated_at) VALUES (?,?,?)`)
        .bind(p, h.slice(0, 220000), now));
    await env.DB.batch(stmts);
  }

  // Recompute the site-wide aggregate ONCE here (every ~30 min), so the
  // public /api/stats endpoint — polled every 15s by every viewer — never has
  // to scan the full, ever-growing cycles table. See computeStats/stats below.
  await refreshStatsCache(env);

  return json({ ok: true, cycle: e.cycle });
}

async function refreshStatsCache(env) {
  const obj = await computeStats(env);
  await env.DB.prepare(
    `INSERT INTO stats_cache (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(obj), new Date().toISOString()).run();
}

async function chatIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const role = m.role === "kimi" ? "kimi" : "cole";
  const text = (m.text ?? "").toString().slice(0, 8000);
  if (!text) return json({ error: "empty" }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO chats (ts, role, text) VALUES (?,?,?)`
  ).bind(m.ts || new Date().toISOString(), role, text).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}

async function milestoneIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const title = (m.title ?? "").toString().slice(0, 200).trim();
  const summary = (m.summary ?? "").toString().slice(0, 2000).trim();
  const tag = (m.tag ?? "milestone").toString().slice(0, 24);
  if (!title) return json({ error: "no title" }, 400);
  const dup = await env.DB.prepare(`SELECT 1 FROM milestones WHERE lower(title)=lower(?)`).bind(title).first();
  if (dup) return json({ ok: true, skipped: "duplicate" });
  const r = await env.DB.prepare(
    `INSERT INTO milestones (ts, title, summary, tag) VALUES (?,?,?,?)`
  ).bind(m.ts || new Date().toISOString(), title, summary, tag).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}

async function milestoneList(request, env) {
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get("limit") || "100", 10), 200);
  const { results } = await env.DB.prepare(
    `SELECT id, ts, title, summary, tag FROM milestones ORDER BY id DESC LIMIT ?`
  ).bind(limit).all();
  return json({ milestones: results });
}

async function stewardIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const report = (m.report ?? "").toString().slice(0, 20000);
  if (!report) return json({ error: "empty" }, 400);
  // Dedup on (ts, cycle) so re-shipping the same log line is idempotent.
  const ts = m.ts || new Date().toISOString();
  const cycle = Number.isFinite(m.cycle) ? m.cycle : null;
  const dup = await env.DB.prepare(
    `SELECT id FROM steward WHERE ts = ? AND IFNULL(cycle,-1) = IFNULL(?,-1) LIMIT 1`
  ).bind(ts, cycle).first();
  if (dup) return json({ ok: true, id: dup.id, dedup: true });
  const r = await env.DB.prepare(
    `INSERT INTO steward (ts, cycle, garden_step, report) VALUES (?,?,?,?)`
  ).bind(ts, cycle, Number.isFinite(m.garden_step) ? m.garden_step : null, report).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}
async function stewardList(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 100);
  const rows = (await env.DB.prepare(
    `SELECT id, ts, cycle, garden_step, report FROM steward ORDER BY id DESC LIMIT ?`
  ).bind(limit).all()).results;
  return json({ reports: rows });
}
async function councilIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const members = Array.isArray(m.members) ? m.members.slice(0, 8).map(x => ({
    name: (x.name || "").toString().slice(0, 40),
    model: (x.model || "").toString().slice(0, 60),
    remark: (x.remark || "").toString().slice(0, 4000),
  })) : [];
  if (!members.length) return json({ error: "empty" }, 400);
  const ts = m.ts || new Date().toISOString();
  const dup = await env.DB.prepare(`SELECT id FROM council WHERE ts = ? LIMIT 1`).bind(ts).first();
  if (dup) return json({ ok: true, id: dup.id, dedup: true });
  const r = await env.DB.prepare(
    `INSERT INTO council (ts, garden_step, members) VALUES (?,?,?)`
  ).bind(ts, Number.isFinite(m.garden_step) ? m.garden_step : null, JSON.stringify(members)).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}
async function councilList(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 200);
  const rows = (await env.DB.prepare(
    `SELECT id, ts, garden_step, members FROM council ORDER BY id DESC LIMIT ?`
  ).bind(limit).all()).results.map(r => ({ ...r, members: JSON.parse(r.members || "[]") }));
  return json({ readings: rows });
}
async function oracleIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const lines = Array.isArray(m.lines) ? m.lines.map(x => x.toString().slice(0, 300)).slice(0, 12) : [];
  if (!lines.length) return json({ error: "empty" }, 400);
  const ts = m.ts || new Date().toISOString();
  const dup = await env.DB.prepare(`SELECT id FROM oracle WHERE ts = ? LIMIT 1`).bind(ts).first();
  if (dup) return json({ ok: true, id: dup.id, dedup: true });
  const r = await env.DB.prepare(
    `INSERT INTO oracle (ts, mode, garden_step, lines) VALUES (?,?,?,?)`
  ).bind(ts, (m.mode || "haiku").toString().slice(0, 16),
         Number.isFinite(m.garden_step) ? m.garden_step : null,
         JSON.stringify(lines)).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}
async function oracleList(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
  const rows = (await env.DB.prepare(
    `SELECT id, ts, mode, garden_step, lines FROM oracle ORDER BY id DESC LIMIT ?`
  ).bind(limit).all()).results.map(r => ({ ...r, lines: JSON.parse(r.lines || "[]") }));
  return json({ poems: rows });
}
async function chatList(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 200);
  const after = url.searchParams.get("after");
  let rows;
  if (after != null) {
    rows = (await env.DB.prepare(
      `SELECT id, ts, role, text FROM chats WHERE id > ? ORDER BY id ASC LIMIT ?`
    ).bind(parseInt(after, 10), limit).all()).results;
  } else {
    rows = (await env.DB.prepare(
      `SELECT id, ts, role, text FROM chats ORDER BY id DESC LIMIT ?`
    ).bind(limit).all()).results.reverse();
  }
  return json({ messages: rows });
}

async function canvasMeta(env) {
  const { results } = await env.DB.prepare(
    `SELECT path, length(html) AS bytes, updated_at FROM pages ORDER BY path`
  ).all();
  const pages = results || [];
  const updated = pages.reduce((m, p) => (p.updated_at && p.updated_at > m ? p.updated_at : m), "") || null;
  return json({
    exists: pages.length > 0,
    count: pages.length,
    pages: pages.map(p => p.path),
    bytes: pages.reduce((s, p) => s + (p.bytes || 0), 0),
    updated_at: updated,
  });
}

const CANVAS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";

// Serve one of the inhabitant's pages, locked down hard: a strict CSP that allows
// inline style/script and data: images but blocks ALL network — so its pages can
// be creative and interactive yet cannot phone home, load trackers, or exfiltrate.
// Relative links between pages (e.g. <a href="about.html">) resolve under /kimi/raw/.
async function serveCanvas(env, subpath) {
  let path = decodeURIComponent((subpath || "").replace(/^\/+/, ""));
  if (path === "" || path.endsWith("/")) path += "index.html";
  const headers = {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": CANVAS_CSP, "x-content-type-options": "nosniff",
  };
  if (path.includes("..")) return new Response("bad path", { status: 400, headers });
  const row = await env.DB.prepare(`SELECT html FROM pages WHERE path = ?`).bind(path).first();
  if (row && row.html != null) return new Response(row.html, { headers });
  const home = path === "index.html";
  const msg = home ? "the inhabitant has not built its page yet" : "no such page (yet)";
  const html = `<!doctype html><meta charset=utf-8><body style="font:15px system-ui;color:#888;background:#0a0a0e;display:grid;place-items:center;height:100vh;margin:0">${msg}</body>`;
  return new Response(html, { status: home ? 200 : 404, headers });
}

// Full-viewport wrapper so terrarium.manticthink.com/kimi *is* the inhabitant's
// page — but rendered inside a sandboxed iframe (opaque origin, no same-origin
// access), so its HTML can never touch this site, cookies, or storage.
function kimiPage(subpath) {
  const src = "/kimi/raw/" + (subpath || "").replace(/^\/+/, "").replace(/"/g, "");
  const desc = "A corner of the open internet written and designed entirely by the terrarium's autonomous AI — whatever it makes of it, unprompted.";
  const img = "https://terrarium.manticthink.com/og-kimi.png";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kimi's Page · a webpage written by an AI</title>
<link rel="icon" type="image/png" href="/seer-emblem.png">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#060608">
<link rel="canonical" href="https://terrarium.manticthink.com/kimi">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SEER · Mantic Think">
<meta property="og:url" content="https://terrarium.manticthink.com/kimi">
<meta property="og:title" content="Kimi's Page — a webpage written by an AI itself">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Kimi's Page — a corner of the web written and designed by the AI itself.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Kimi's Page — a webpage written by an AI itself">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<style>html,body{margin:0;height:100%;background:#060608}iframe{border:0;width:100%;height:100vh;display:block}</style>
</head><body><iframe src="${src}" sandbox="allow-scripts" title="A page written by the terrarium inhabitant"></iframe></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function xmlEsc(s){ return (s ?? "").toString().replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c])); }
async function rss(request, env) {
  const origin = new URL(request.url).origin;
  const { results } = await env.DB.prepare(
    `SELECT cycle, started_at, summary FROM cycles ORDER BY cycle DESC LIMIT 40`
  ).all();
  const items = (results || []).map(r => `
    <item>
      <title>Cycle ${r.cycle} — the terrarium woke</title>
      <link>${origin}/#/cycle/${r.cycle}</link>
      <guid isPermaLink="false">terrarium-cycle-${r.cycle}</guid>
      ${r.started_at ? `<pubDate>${new Date(r.started_at).toUTCString()}</pubDate>` : ""}
      <description>${xmlEsc((r.summary || "").slice(0, 600))}</description>
    </item>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>The Terrarium — an autonomous mind</title>
  <link>${origin}/</link>
  <description>What an unguided AI did each time it woke.</description>
  ${items}
</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "no-store" } });
}

async function listEvents(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "40", 10), 100);
  const before = url.searchParams.get("before");
  // Light list payload — omit the heavy reasoning/journal blobs for the feed.
  let q = `SELECT cycle, started_at, ended_at, duration_s, status, exit_code,
                  summary, commands_json, num_commands, files_json, num_files_changed,
                  output_tokens, reasoning_tokens, chars_out, space_bytes,
                  space_files_json, vitality, vitality_delta, cycle_effort
           FROM cycles`;
  const binds = [];
  if (before) { q += ` WHERE cycle < ?`; binds.push(parseInt(before, 10)); }
  q += ` ORDER BY cycle DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return json({ events: results.map(hydrate) });
}

async function oneEvent(env, cycle) {
  const row = await env.DB.prepare(`SELECT * FROM cycles WHERE cycle = ?`).bind(parseInt(cycle, 10)).first();
  if (!row) return json({ error: "not found" }, 404);
  return json(hydrate(row));
}

function hydrate(r) {
  const parse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
  return {
    ...r,
    commands: parse(r.commands_json),
    files_changed: parse(r.files_json),
    space_files: parse(r.space_files_json),
  };
}

async function journalIngest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) return json({ error: "unauthorized" }, 401);
  let m;
  try { m = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const head = (m.head ?? "").toString().trim();
  if (!head) return json({ error: "empty" }, 400);
  // Dedup on `head` — once an entry is recorded it is never replaced or removed,
  // so a later prune (or edit) of journal.md can't erase it from the site.
  const dup = await env.DB.prepare(
    `SELECT id FROM journal_entries WHERE head = ? LIMIT 1`
  ).bind(head).first();
  if (dup) return json({ ok: true, id: dup.id, dedup: true });
  const r = await env.DB.prepare(
    `INSERT INTO journal_entries (ts, head, title, body, cycle) VALUES (?,?,?,?,?)`
  ).bind(m.ts || "", head, (m.title ?? "").toString(), (m.body ?? "").toString().slice(0, 60000),
         Number.isFinite(m.cycle) ? m.cycle : null).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}

async function journalView(env) {
  // Full, append-only history (oldest -> newest = 0 -> 1). Prune-proof.
  const rows = (await env.DB.prepare(
    `SELECT ts, head, body, cycle FROM journal_entries ORDER BY ts ASC, id ASC`
  ).all()).results || [];
  if (rows.length) {
    const md = rows.map(r => `## ${r.head}\n\n${r.body}`).join("\n\n");
    const last = rows[rows.length - 1];
    return json({ cycle: last.cycle, at: last.ts, entries: rows.length, full: true, journal: md });
  }
  // Fallback to the latest cycle excerpt until the backfill has populated the table.
  const row = await env.DB.prepare(
    `SELECT cycle, started_at, journal_excerpt FROM cycles
     WHERE journal_excerpt IS NOT NULL AND journal_excerpt != ''
     ORDER BY cycle DESC LIMIT 1`
  ).first();
  return json({
    cycle: row ? row.cycle : null,
    at: row ? row.started_at : null,
    full: false,
    journal: row ? row.journal_excerpt : "",
  });
}

async function thoughts(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 60);
  const before = url.searchParams.get("before");
  let q = `SELECT cycle, started_at, reasoning, reasoning_tokens, summary
           FROM cycles WHERE reasoning IS NOT NULL AND reasoning != ''`;
  const binds = [];
  if (before) { q += ` AND cycle < ?`; binds.push(parseInt(before, 10)); }
  q += ` ORDER BY cycle DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return json({ thoughts: results });
}

// Public stats: serve the precomputed aggregate (one row, O(1)) refreshed on
// each ingest. Falls back to a live compute if the cache row isn't there yet
// (e.g. right after deploy, before the next wake) so it's always correct.
async function stats(env) {
  const row = await env.DB.prepare(`SELECT json FROM stats_cache WHERE id = 1`).first();
  if (row && row.json) {
    return new Response(row.json, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return json(await computeStats(env));
}

// The expensive full-table aggregation. Runs once per ingest, never on the
// hot read path.
async function computeStats(env) {
  const agg = await env.DB.prepare(
    `SELECT COUNT(*)              AS total_cycles,
            MIN(started_at)       AS first_at,
            MAX(started_at)       AS last_at,
            MAX(ended_at)         AS last_ended,
            SUM(num_commands)     AS total_commands,
            SUM(num_files_changed) AS total_file_changes,
            SUM(output_tokens)    AS total_output_tokens,
            SUM(reasoning_tokens) AS total_reasoning_tokens,
            SUM(chars_out)        AS total_chars,
            SUM(duration_s)       AS total_awake_s
     FROM cycles`
  ).first();

  const byStatus = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM cycles GROUP BY status`
  ).all();

  const latest = await env.DB.prepare(
    `SELECT cycle, started_at, status, space_bytes, space_files_json, journal_excerpt,
            vitality, vitality_delta
     FROM cycles ORDER BY cycle DESC LIMIT 1`
  ).first();

  let space_file_count = 0;
  if (latest && latest.space_files_json) {
    try { space_file_count = JSON.parse(latest.space_files_json).length; } catch {}
  }

  // recent vitality trend (oldest→newest) for a sparkline
  const series = await env.DB.prepare(
    `SELECT vitality FROM cycles ORDER BY cycle DESC LIMIT 40`
  ).all();
  const vitality_series = (series.results || []).map(r => r.vitality).reverse();

  return {
    ...agg,
    status_breakdown: byStatus.results,
    latest_cycle: latest ? latest.cycle : null,
    latest_at: latest ? latest.started_at : null,
    space_bytes: latest ? latest.space_bytes : null,
    space_file_count,
    journal_excerpt: latest ? latest.journal_excerpt : null,
    vitality: latest ? latest.vitality : null,
    vitality_delta: latest ? latest.vitality_delta : null,
    vitality_series,
  };
}
