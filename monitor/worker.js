// terrarium.manticthink.com — live monitor for the terrarium inhabitant.
// The VPS harness POSTs one event per wake cycle to /api/ingest (bearer-auth).
// The public read endpoints power the SEER-styled observatory UI in ./public.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/ingest" && request.method === "POST") return ingest(request, env);
    if (pathname === "/api/events" && request.method === "GET") return listEvents(request, env);
    if (pathname === "/api/stats" && request.method === "GET") return stats(env);
    if (pathname === "/api/journal" && request.method === "GET") return journalView(env);
    if (pathname === "/api/canvas" && request.method === "GET") return canvasMeta(env);
    if (pathname === "/kimi/raw" && request.method === "GET") return serveCanvas(env);
    if (pathname === "/kimi" && request.method === "GET") return kimiPage();
    if (pathname === "/feed.xml" && request.method === "GET") return rss(request, env);
    if (pathname.startsWith("/api/events/") && request.method === "GET")
      return oneEvent(env, pathname.split("/").pop());

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
       space_files_json, space_bytes, received_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      new Date().toISOString()
    )
    .run();

  // "Kimi's Page" — the inhabitant's self-authored public webpage. Stored as a
  // single row; updated whenever a cycle ships fresh HTML for it.
  if (typeof e.canvas_html === "string" && e.canvas_html.length) {
    await env.DB.prepare(
      `INSERT INTO site (id, html, cycle, updated_at) VALUES (1,?,?,?)
       ON CONFLICT(id) DO UPDATE SET html=excluded.html, cycle=excluded.cycle, updated_at=excluded.updated_at`
    ).bind(e.canvas_html, e.cycle, new Date().toISOString()).run();
  }

  return json({ ok: true, cycle: e.cycle });
}

async function canvasMeta(env) {
  const row = await env.DB.prepare(`SELECT cycle, updated_at, length(html) AS bytes FROM site WHERE id=1`).first();
  return json({ exists: !!row, cycle: row?.cycle ?? null, updated_at: row?.updated_at ?? null, bytes: row?.bytes ?? 0 });
}

// Serve the inhabitant's HTML, locked down hard: a strict CSP that allows inline
// style/script and data: images but blocks ALL network — so its page can be
// creative and interactive yet cannot phone home, load trackers, or exfiltrate.
async function serveCanvas(env) {
  const row = await env.DB.prepare(`SELECT html FROM site WHERE id=1`).first();
  const html = row?.html || "<!doctype html><meta charset=utf-8><body style=\"font:15px system-ui;color:#888;background:#0a0a0e;display:grid;place-items:center;height:100vh;margin:0\">the inhabitant has not built its page yet</body>";
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

// Full-viewport wrapper so terrarium.manticthink.com/kimi *is* the inhabitant's
// page — but rendered inside a sandboxed iframe (opaque origin, no same-origin
// access), so its HTML can never touch this site, cookies, or storage.
function kimiPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kimi's Page · Terrarium</title>
<style>html,body{margin:0;height:100%;background:#060608}iframe{border:0;width:100%;height:100vh;display:block}</style>
</head><body><iframe src="/kimi/raw" sandbox="allow-scripts" title="A page written by the terrarium inhabitant"></iframe></body></html>`;
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
                  space_files_json
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

async function journalView(env) {
  const row = await env.DB.prepare(
    `SELECT cycle, started_at, journal_excerpt FROM cycles
     WHERE journal_excerpt IS NOT NULL AND journal_excerpt != ''
     ORDER BY cycle DESC LIMIT 1`
  ).first();
  return json({
    cycle: row ? row.cycle : null,
    at: row ? row.started_at : null,
    journal: row ? row.journal_excerpt : "",
  });
}

async function stats(env) {
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
    `SELECT cycle, started_at, status, space_bytes, space_files_json, journal_excerpt
     FROM cycles ORDER BY cycle DESC LIMIT 1`
  ).first();

  let space_file_count = 0;
  if (latest && latest.space_files_json) {
    try { space_file_count = JSON.parse(latest.space_files_json).length; } catch {}
  }

  return json({
    ...agg,
    status_breakdown: byStatus.results,
    latest_cycle: latest ? latest.cycle : null,
    latest_at: latest ? latest.started_at : null,
    space_bytes: latest ? latest.space_bytes : null,
    space_file_count,
    journal_excerpt: latest ? latest.journal_excerpt : null,
  });
}
