import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ResultArtifactSummary {
  file: string;
  kind: 'suite' | 'run' | 'watch' | 'flake' | 'other';
  title: string;
  passed?: boolean;
  status?: string;
  createdAt?: string;
  totalTokens?: number;
  toolCalls?: number;
  durationMs?: number;
  failures: string[];
  fingerprint?: string;
  scenarioTotal?: number;
  scenarioPassed?: number;
  scenarioFailed?: number;
  scenarioSkipped?: number;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function summarizeArtifact(file: string, value: unknown): ResultArtifactSummary {
  const data = record(value) ?? {};
  const metrics = record(data.metrics);
  const failures = Array.isArray(data.failures) ? data.failures.filter((item): item is string => typeof item === 'string') : [];
  if (typeof data.suite === 'string' && Array.isArray(data.scenarios)) {
    const suiteFailures = data.scenarios.flatMap((entry) => {
      const item = record(entry);
      if (!item || item.passed === true) return [];
      if (typeof item.infrastructureError === 'string') return [item.infrastructureError];
      const result = record(item.result);
      return Array.isArray(result?.failures) ? result.failures.filter((failure): failure is string => typeof failure === 'string') : [];
    });
    return {
      file,
      kind: 'suite',
      title: data.suite,
      passed: data.passed === true,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures: suiteFailures,
      scenarioTotal: numberValue(data.total) ?? data.scenarios.length,
      scenarioPassed: numberValue(data.passedCount),
      scenarioFailed: numberValue(data.failedCount),
      scenarioSkipped: numberValue(data.skippedBySelection),
    };
  }
  if (typeof data.status === 'string' && typeof data.latest === 'string') {
    return {
      file,
      kind: 'watch',
      title: `Release watch ${data.latest}`,
      status: data.status,
      passed: data.status === 'compatible' || data.status === 'no-change' || data.status === 'initialized',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures,
    };
  }
  if (typeof data.classification === 'string' && typeof data.passRate === 'number') {
    return {
      file,
      kind: 'flake',
      title: typeof data.scenario === 'string' ? data.scenario : file,
      status: `${data.classification} (${(data.passRate * 100).toFixed(1)}%)`,
      passed: data.classification !== 'flaky',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures,
    };
  }
  if (typeof data.scenario === 'string' && typeof data.passed === 'boolean') {
    return {
      file,
      kind: 'run',
      title: data.scenario,
      passed: data.passed,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      totalTokens: typeof metrics?.totalTokens === 'number' ? metrics.totalTokens : undefined,
      toolCalls: typeof metrics?.toolCalls === 'number' ? metrics.toolCalls : undefined,
      durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
      failures,
      fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : undefined,
    };
  }
  return { file, kind: 'other', title: file, failures };
}

export async function loadResultSummaries(directory: string): Promise<ResultArtifactSummary[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const summaries: ResultArtifactSummary[] = [];
  for (const name of names) {
    const file = path.join(directory, name);
    let value: unknown;
    try {
      const raw = await readFile(file, 'utf8');
      if (raw.length > 10 * 1024 * 1024) continue;
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    summaries.push(summarizeArtifact(name, value));
  }
  return summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.file.localeCompare(b.file));
}

function resultLabel(item: ResultArtifactSummary): string {
  return item.passed === undefined ? (item.status ?? 'info') : item.passed ? 'PASS' : 'FAIL';
}

function metricsLabel(item: ResultArtifactSummary): string {
  const suiteMetrics = item.scenarioTotal === undefined ? [] : [
    `${item.scenarioTotal} scenarios`,
    item.scenarioPassed === undefined ? '' : `${item.scenarioPassed} passed`,
    item.scenarioFailed === undefined ? '' : `${item.scenarioFailed} failed`,
    item.scenarioSkipped === undefined || item.scenarioSkipped === 0 ? '' : `${item.scenarioSkipped} skipped`,
  ];
  return [
    ...suiteMetrics,
    item.totalTokens === undefined ? '' : `${item.totalTokens} tokens`,
    item.toolCalls === undefined ? '' : `${item.toolCalls} tools`,
    item.durationMs === undefined ? '' : `${item.durationMs} ms`,
  ].filter(Boolean).join(' · ');
}

export function renderStaticHtmlReport(summaries: ResultArtifactSummary[], title = 'Claude Code Canary Report'): string {
  const passed = summaries.filter((item) => item.passed === true).length;
  const failed = summaries.filter((item) => item.passed === false).length;
  const informational = summaries.length - passed - failed;
  const kinds = [...new Set(summaries.map((item) => item.kind))].sort();
  const kindOptions = kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`).join('');
  const rows = summaries.map((item, index) => {
    const result = resultLabel(item);
    const metrics = metricsLabel(item);
    const failures = item.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('');
    const failureCell = failures
      ? `<details><summary>${item.failures.length} issue${item.failures.length === 1 ? '' : 's'}</summary><ul>${failures}</ul></details>`
      : '';
    const state = item.passed === false ? 'fail' : item.passed === true ? 'pass' : 'info';
    const searchText = [item.kind, item.title, item.file, result, item.status ?? '', item.fingerprint ?? '', ...item.failures]
      .join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return `<tr id="artifact-${index + 1}" data-kind="${escapeHtml(item.kind)}" data-state="${state}" data-created="${escapeHtml(item.createdAt ?? '')}" data-title="${escapeHtml(item.title.toLowerCase())}" data-search="${escapeHtml(searchText)}"><td><span class="kind">${escapeHtml(item.kind)}</span></td><td><strong>${escapeHtml(item.title)}</strong><div class="muted mono">${escapeHtml(item.file)}</div></td><td class="${state}">${escapeHtml(result)}</td><td>${escapeHtml(item.createdAt ?? '')}</td><td>${escapeHtml(metrics)}</td><td>${failureCell}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--panel:#f8fafc;--text:#171717;--muted:#667085;--line:#e4e7ec;--accent:#175cd3;--pass:#08752b;--fail:#b42318;--info:#475467}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:var(--bg);color:var(--text);line-height:1.45}.shell{max-width:1500px;margin:0 auto;padding:2rem}h1{margin:0 0 .25rem;font-size:clamp(1.5rem,3vw,2.25rem)}.muted{color:var(--muted);font-size:.86rem}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1.25rem 0}.card{appearance:none;text-align:left;border:1px solid var(--line);background:var(--panel);color:inherit;border-radius:10px;padding:.9rem 1rem;min-width:0;cursor:pointer}.card:hover,.card:focus-visible{border-color:var(--accent);outline:none}.card strong{font-size:1.4rem}.pass{color:var(--pass);font-weight:700}.fail{color:var(--fail);font-weight:700}.info{color:var(--info);font-weight:700}.toolbar{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:minmax(15rem,2fr) repeat(3,minmax(8rem,1fr)) auto auto;gap:.6rem;align-items:end;padding:.8rem;margin:0 0 1rem;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:10px}.control label{display:block;font-size:.75rem;color:var(--muted);margin:0 0 .2rem}.control input,.control select,.toolbar button{width:100%;min-height:2.35rem;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:inherit;padding:.45rem .6rem;font:inherit}.toolbar button{width:auto;cursor:pointer}.toolbar button:hover,.toolbar button:focus-visible{border-color:var(--accent);outline:none}.status-line{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin:.5rem 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:980px}th,td{text-align:left;vertical-align:top;padding:.7rem;border-bottom:1px solid var(--line)}th{position:sticky;top:0;background:var(--panel);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}tbody tr:last-child td{border-bottom:0}tbody tr:target{outline:2px solid var(--accent);outline-offset:-2px}.kind{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.12rem .45rem;font-size:.75rem}details summary{cursor:pointer;color:var(--fail)}ul{margin:.35rem 0;padding-left:1.2rem}.pagination{display:flex;align-items:center;justify-content:center;gap:.65rem;margin:1rem 0}.pagination button{border:1px solid var(--line);background:var(--bg);color:inherit;border-radius:7px;padding:.4rem .8rem;cursor:pointer}.pagination button:disabled{opacity:.45;cursor:not-allowed}.empty{display:none;text-align:center;padding:2rem;color:var(--muted)}@media(max-width:900px){.shell{padding:1rem}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{position:static;grid-template-columns:1fr 1fr}.toolbar .search{grid-column:1/-1}.status-line{align-items:flex-start;flex-direction:column}}@media(prefers-color-scheme:dark){:root{--bg:#111318;--panel:#181b21;--text:#f5f5f5;--muted:#98a2b3;--line:#344054;--accent:#84adff;--pass:#75e094;--fail:#ff8a82;--info:#b8c0cc}}
</style></head>
<body><main class="shell"><h1>${escapeHtml(title)}</h1><div class="muted">Portable, privacy-minimized summary. Raw prompts, transcripts and environment values are not embedded.</div>
<div class="summary" aria-label="Report summary"><button class="card" type="button" data-set-status="all"><strong>${summaries.length}</strong><br>artifacts</button><button class="card" type="button" data-set-status="pass"><strong class="pass">${passed}</strong><br>passing</button><button class="card" type="button" data-set-status="fail"><strong class="fail">${failed}</strong><br>failing</button><button class="card" type="button" data-set-status="info"><strong class="info">${informational}</strong><br>informational</button></div>
<section class="toolbar" aria-label="Report navigation"><div class="control search"><label for="search">Search artifacts, failures or fingerprints</label><input id="search" type="search" placeholder="Search report…" autocomplete="off"></div><div class="control"><label for="statusFilter">Result</label><select id="statusFilter"><option value="all">All results</option><option value="fail">Failing</option><option value="pass">Passing</option><option value="info">Informational</option></select></div><div class="control"><label for="kindFilter">Kind</label><select id="kindFilter"><option value="all">All kinds</option>${kindOptions}</select></div><div class="control"><label for="sortOrder">Sort</label><select id="sortOrder"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="kind">Kind A–Z</option><option value="result">Failures first</option></select></div><div class="control"><label for="pageSize">Rows</label><select id="pageSize"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option><option value="all">All</option></select></div><button id="firstFailure" type="button">First failure</button><button id="clearFilters" type="button">Reset</button></section>
<div class="status-line"><div id="visibleCount" class="muted" aria-live="polite"></div><div class="muted">Tip: press <span class="mono">/</span> to search, <span class="mono">Esc</span> to clear search.</div></div>
<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Artifact</th><th>Result</th><th>Created</th><th>Metrics</th><th>Failures</th></tr></thead><tbody id="reportRows">${rows}</tbody></table><div id="emptyState" class="empty">No artifacts match the current filters.</div></div>
<nav class="pagination" aria-label="Report pages"><button id="prevPage" type="button">Previous</button><span id="pageLabel" class="muted"></span><button id="nextPage" type="button">Next</button></nav></main>
<script>
(function(){
  var rows=Array.prototype.slice.call(document.querySelectorAll('#reportRows tr'));
  var body=document.getElementById('reportRows');
  var search=document.getElementById('search');
  var status=document.getElementById('statusFilter');
  var kind=document.getElementById('kindFilter');
  var sort=document.getElementById('sortOrder');
  var pageSize=document.getElementById('pageSize');
  var count=document.getElementById('visibleCount');
  var empty=document.getElementById('emptyState');
  var pageLabel=document.getElementById('pageLabel');
  var prev=document.getElementById('prevPage');
  var next=document.getElementById('nextPage');
  var page=1;
  var stateRank={fail:0,pass:1,info:2};
  function params(){try{return new URLSearchParams(location.search);}catch(_){return new URLSearchParams();}}
  function restore(){var p=params();search.value=p.get('q')||'';status.value=p.get('status')||'all';kind.value=p.get('kind')||'all';sort.value=p.get('sort')||'newest';pageSize.value=p.get('rows')||'50';page=Math.max(1,Number(p.get('page'))||1);}
  function persist(){try{var p=new URLSearchParams();if(search.value)p.set('q',search.value);if(status.value!=='all')p.set('status',status.value);if(kind.value!=='all')p.set('kind',kind.value);if(sort.value!=='newest')p.set('sort',sort.value);if(pageSize.value!=='50')p.set('rows',pageSize.value);if(page>1)p.set('page',String(page));history.replaceState(null,'',location.pathname+(p.toString()?'?'+p.toString():'')+location.hash);}catch(_){}}
  function compare(a,b){if(sort.value==='oldest')return (a.dataset.created||'').localeCompare(b.dataset.created||'')||a.dataset.title.localeCompare(b.dataset.title);if(sort.value==='title')return a.dataset.title.localeCompare(b.dataset.title);if(sort.value==='kind')return a.dataset.kind.localeCompare(b.dataset.kind)||a.dataset.title.localeCompare(b.dataset.title);if(sort.value==='result')return stateRank[a.dataset.state]-stateRank[b.dataset.state]||b.dataset.created.localeCompare(a.dataset.created);return (b.dataset.created||'').localeCompare(a.dataset.created||'')||a.dataset.title.localeCompare(b.dataset.title);}
  function render(resetPage){if(resetPage)page=1;var q=search.value.trim().toLowerCase();var filtered=rows.filter(function(row){return (!q||row.dataset.search.indexOf(q)!==-1)&&(status.value==='all'||row.dataset.state===status.value)&&(kind.value==='all'||row.dataset.kind===kind.value);}).sort(compare);filtered.forEach(function(row){body.appendChild(row);});var size=pageSize.value==='all'?Math.max(filtered.length,1):Number(pageSize.value);var pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.min(page,pages);var start=(page-1)*size;var end=Math.min(start+size,filtered.length);rows.forEach(function(row){row.hidden=true;});filtered.slice(start,end).forEach(function(row){row.hidden=false;});count.textContent='Showing '+(filtered.length?start+1:0)+'–'+end+' of '+filtered.length+' matching · '+rows.length+' total';empty.style.display=filtered.length?'none':'block';pageLabel.textContent='Page '+page+' of '+pages;prev.disabled=page<=1;next.disabled=page>=pages;document.querySelector('.pagination').style.display=pageSize.value==='all'||filtered.length===0?'none':'flex';persist();}
  [search,status,kind,sort,pageSize].forEach(function(el){el.addEventListener(el===search?'input':'change',function(){render(true);});});
  document.querySelectorAll('[data-set-status]').forEach(function(button){button.addEventListener('click',function(){status.value=button.dataset.setStatus;render(true);});});
  document.getElementById('clearFilters').addEventListener('click',function(){search.value='';status.value='all';kind.value='all';sort.value='newest';pageSize.value='50';render(true);search.focus();});
  document.getElementById('firstFailure').addEventListener('click',function(){status.value='fail';render(true);var first=Array.prototype.find.call(document.querySelectorAll('#reportRows tr:not([hidden])'),function(row){return row.dataset.state==='fail';});if(first){location.hash=first.id;first.scrollIntoView({behavior:'smooth',block:'center'});}});
  prev.addEventListener('click',function(){if(page>1){page-=1;render(false);window.scrollTo({top:0,behavior:'smooth'});}});next.addEventListener('click',function(){page+=1;render(false);window.scrollTo({top:0,behavior:'smooth'});});
  document.addEventListener('keydown',function(event){if(event.key==='/'&&document.activeElement!==search){event.preventDefault();search.focus();}else if(event.key==='Escape'&&document.activeElement===search){search.value='';render(true);}});
  restore();render(false);
})();
</script></body></html>`;
}

export async function generateStaticHtmlReport(inputDirectory: string, outputDirectory: string, title?: string): Promise<string> {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  const summaries = await loadResultSummaries(input);
  await mkdir(output, { recursive: true });
  const reportPath = path.join(output, 'index.html');
  await writeFile(reportPath, renderStaticHtmlReport(summaries, title), 'utf8');
  return reportPath;
}
