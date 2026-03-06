"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const fs_1 = require("fs");
const path_1 = require("path");
const logger_1 = require("./core/logger");
const paths_1 = require("./core/paths");
const PORT = 3001;
const OPENCLAW_DIR = (0, paths_1.getDataDir)();
// Simple router
function handleRequest(req, res) {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
        if (pathname === '/' || pathname === '/workflows') {
            serveWorkflowsPage(res);
        }
        else if (pathname.startsWith('/workflows/')) {
            const traceId = pathname.split('/')[2];
            if (traceId && traceId.includes('-')) {
                serveTraceDetailPage(res, traceId);
            }
            else {
                res.statusCode = 404;
                res.end('Not found');
            }
        }
        else if (pathname.startsWith('/api/traces')) {
            serveJson(res, listTraces());
        }
        else if (pathname.startsWith('/api/trace/')) {
            const traceId = pathname.split('/')[2];
            if (traceId) {
                serveTraceJson(res, traceId);
            }
        }
        else if (pathname.startsWith('/api/artifacts/')) {
            const parts = pathname.split('/');
            const traceId = parts[2];
            const stageId = parts[3];
            if (traceId && stageId) {
                serveArtifact(res, traceId, stageId);
            }
        }
        else if (pathname.startsWith('/api/logs/')) {
            const parts = pathname.split('/');
            const component = parts[2];
            const date = parts[3];
            if (component && date) {
                serveLogs(res, component, date);
            }
        }
        else {
            res.statusCode = 404;
            res.end('Not found');
        }
    }
    catch (err) {
        res.statusCode = 500;
        res.end(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function serveWorkflowsPage(res) {
    const traces = listTraces();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>OpenClaw Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; background: #f5f5f5; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #4a5568; color: white; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    a { color: #3182ce; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-completed { background: #c6f6d5; color: #22543d; }
    .badge-failed { background: #fed7d7; color: #742a2a; }
    .empty { color: #718096; font-style: italic; }
  </style>
</head>
<body>
  <h1>OpenClaw Workflows</h1>
  <table>
    <thead>
      <tr>
        <th>Trace ID</th>
        <th>Date</th>
        <th>Stages</th>
        <th>Duration</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${traces.length === 0 ? '<tr><td colspan="5" class="empty">No traces found</td></tr>' : traces.map(t => `
        <tr>
          <td><a href="/workflows/${t.traceId}">${t.traceId.substring(0, 12)}...</a></td>
          <td>${t.date}</td>
          <td>${t.stages || 0} stages</td>
          <td>${t.durationMs || 0}ms</td>
          <td><span class="badge badge-${t.status || 'unknown'}">${t.status || 'unknown'}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;
    res.end(html);
}
function serveTraceDetailPage(res, traceId) {
    const tracePath = (0, path_1.join)(OPENCLAW_DIR, 'logs', 'traces', `${traceId}.jsonl`);
    const artifactsDir = (0, path_1.join)(OPENCLAW_DIR, 'artifacts', traceId);
    const hasArtifacts = (0, fs_1.existsSync)(artifactsDir);
    let traceData = null;
    if ((0, fs_1.existsSync)(tracePath)) {
        try {
            const content = (0, fs_1.readFileSync)(tracePath, 'utf8');
            const lines = content.trim().split('\n').filter(l => l);
            if (lines.length > 0) {
                traceData = JSON.parse(lines[lines.length - 1]);
            }
        }
        catch (err) {
            traceData = null;
        }
    }
    const stages = traceData?.stages || [];
    const status = traceData?.status || 'unknown';
    const duration = traceData?.durationMs || 0;
    const startedAt = traceData?.startedAt || '';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Trace ${traceId.substring(0, 12)}... - OpenClaw</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 40px; background: #f5f5f5; }
    .header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-completed { background: #c6f6d5; color: #22543d; }
    .badge-failed { background: #fed7d7; color: #742a2a; }
    .badge-running { background: #bee3f8; color: #2a4365; }
    pre { background: #2d3748; color: #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
    .stage-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 12px; background: white; }
    .stage-header { display: flex; justify-content: space-between; align-items: center; }
    .stage-status { font-weight: 600; }
    .log-entry { font-family: monospace; font-size: 12px; color: #718096; margin: 2px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Trace: ${traceId.substring(0, 16)}...</h1>
    <div class="grid">
      <div>
        <p><strong>Status:</strong> <span class="badge badge-${status}">${status}</span></p>
        <p><strong>Duration:</strong> ${duration}ms</p>
        <p><strong>Started:</strong> ${new Date(startedAt).toLocaleString()}</p>
      </div>
      <div>
        <p><strong>Stages:</strong> ${stages.length}</p>
        <p><strong>Artifacts:</strong> ${hasArtifacts ? '✅ Available' : '❌ Not found'}</p>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Stages</h2>
    ${stages.length === 0 ? '<p class="empty">No stage data</p>' : stages.map((s, idx) => `
      <div class="stage-item">
        <div class="stage-header">
          <strong>${idx + 1}. ${s.stageId}</strong>
          <span class="stage-status badge badge-${s.status}">${s.status}</span>
        </div>
        <p><small>Agent: ${s.agentId} | Duration: ${s.durationMs}ms | Model: ${s.modelUsed || 'N/A'} | Attempt: ${s.attempt || 1}</small></p>
        ${s.error ? `<pre style="color:#e53e3e;">${JSON.stringify(s.error, null, 2)}</pre>` : ''}
        ${hasArtifacts ? `<p><a href="/api/artifacts/${traceId}/${s.stageId}" target="_blank">View artifact JSON</a></p>` : ''}
      </div>
    `).join('')}
  </div>

  <div class="card" style="margin-top: 20px;">
    <h2>Raw Trace Logs (latest entries)</h2>
    <div id="logs"></div>
  </div>

  <script>
    async function loadLogs() {
      try {
        const resp = await fetch('/api/logs/orchestrator/' + new Date().toISOString().split('T')[0]);
        if (resp.ok) {
          const lines = await resp.text();
          const entries = lines.trim().split('\\n').slice(-10).map(l => JSON.parse(l));
          document.getElementById('logs').innerHTML = entries.map(e =>
            '<div class="log-entry">['+e.timestamp+'] <'+e.level+'> '+e.message+'</div>'
          ).join('');
        }
      } catch (err) {
        document.getElementById('logs').innerHTML = '<p class="empty">Could not load logs</p>';
      }
    }
    loadLogs();
  </script>
</body>
</html>`;
    res.end(html);
}
function listTraces() {
    const tracesDir = (0, path_1.join)(OPENCLAW_DIR, 'logs', 'traces');
    if (!(0, fs_1.existsSync)(tracesDir))
        return [];
    const files = (0, fs_1.readdirSync)(tracesDir).filter(f => f.endsWith('.jsonl'));
    const traces = [];
    for (const file of files) {
        const filePath = (0, path_1.join)(tracesDir, file);
        const stat = (0, fs_1.statSync)(filePath);
        const date = file.replace('.jsonl', '');
        let content = (0, fs_1.readFileSync)(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        if (lines.length > 0) {
            try {
                const lastTrace = JSON.parse(lines[lines.length - 1]);
                traces.push({
                    traceId: lastTrace.traceId,
                    date,
                    size: stat.size,
                    stages: (lastTrace.stages?.length) || 0,
                    durationMs: lastTrace.durationMs || 0,
                    status: lastTrace.status,
                });
            }
            catch (err) {
                // ignore
            }
        }
    }
    return traces.sort((a, b) => b.date.localeCompare(a.date) && 0).slice(0, 50);
}
function serveJson(res, data) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data, null, 2));
}
function serveTraceJson(res, traceId) {
    const tracePath = (0, path_1.join)(OPENCLAW_DIR, 'logs', 'traces', `${traceId}.jsonl`);
    if (!(0, fs_1.existsSync)(tracePath)) {
        res.statusCode = 404;
        res.end('Trace not found');
        return;
    }
    const content = (0, fs_1.readFileSync)(tracePath, 'utf8');
    const traces = content.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
    serveJson(res, traces);
}
function serveArtifact(res, traceId, stageId) {
    const artifactPath = (0, path_1.join)(OPENCLAW_DIR, 'artifacts', traceId, `${stageId}.json`);
    if (!(0, fs_1.existsSync)(artifactPath)) {
        res.statusCode = 404;
        res.end('Artifact not found');
        return;
    }
    const content = (0, fs_1.readFileSync)(artifactPath, 'utf8');
    serveJson(res, JSON.parse(content));
}
function serveLogs(res, component, date) {
    const logFile = (0, path_1.join)(OPENCLAW_DIR, 'logs', component, `${date}.log`);
    if (!(0, fs_1.existsSync)(logFile)) {
        res.statusCode = 404;
        res.end('Log not found');
        return;
    }
    const content = (0, fs_1.readFileSync)(logFile, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(content);
}
// Start server
const server = (0, http_1.createServer)(handleRequest);
server.listen(PORT, () => {
    logger_1.orchestratorLogger.info(`Dashboard server listening on http://localhost:${PORT}`);
    console.log(`OpenClaw Dashboard v0 running at http://localhost:${PORT}`);
    console.log(`Workflows: http://localhost:${PORT}/workflows`);
});
