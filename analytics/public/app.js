'use strict';

const byId = (id) => document.getElementById(id);
const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const count = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const metricNames = { activeInstallations: 'Active installations', events: 'Events', callsStarted: 'Calls started', callsCompleted: 'Calls completed', durationMinutes: 'Call minutes' };
const knownVersions = new Set();
const knownPlatforms = new Set();
let daily = [];
let request = 0;
let controller;

function params() {
  const query = new URLSearchParams({ days: byId('days').value });
  for (const key of ['version', 'platform']) if (byId(key).value) query.set(key, byId(key).value);
  return query;
}

function cell(row, value) {
  const element = document.createElement('td');
  element.textContent = value;
  row.append(element);
}

function table(id, rows, columns, empty) {
  const body = byId(id);
  body.replaceChildren();
  for (const item of rows) {
    const row = document.createElement('tr');
    for (const column of columns) cell(row, column(item));
    body.append(row);
  }
  if (!rows.length) {
    const row = document.createElement('tr');
    const element = document.createElement('td');
    element.colSpan = columns.length;
    element.className = 'empty-cell';
    element.textContent = empty;
    row.append(element);
    body.append(row);
  }
}

function options(id, rows, key, known) {
  const select = byId(id);
  const selected = select.value;
  for (const row of rows) if (typeof row[key] === 'string' && row[key]) known.add(row[key]);
  for (const value of Array.from(known).sort()) {
    if (Array.from(select.options).some((option) => option.value === value)) continue;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = selected;
}

function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawChart() {
  const chart = byId('chart');
  chart.replaceChildren();
  const metric = byId('metric').value;
  if (!daily.length) {
    const message = document.createElement('p');
    message.className = 'chart-empty';
    message.textContent = 'No daily activity for these filters.';
    chart.append(message);
    return;
  }
  const width = 1080, height = 280, left = 62, right = 20, top = 24, bottom = 42;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = daily.map((row) => count(row[metric]));
  const max = Math.max(1, ...values);
  const ceiling = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (index) => left + (daily.length === 1 ? plotWidth / 2 : index / (daily.length - 1) * plotWidth);
  const y = (value) => top + plotHeight - value / ceiling * plotHeight;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'chart-title chart-description' });
  svg.append(svgElement('title', { id: 'chart-title' }, `${metricNames[metric]} by day`));
  svg.append(svgElement('desc', { id: 'chart-description' }, `${daily[0].day} to ${daily[daily.length - 1].day}, UTC. Exact values are available in View daily data below.`));
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * ceiling / 4;
    svg.append(svgElement('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'grid' }));
    svg.append(svgElement('text', { x: left - 12, y: y(value) + 4, 'text-anchor': 'end' }, format.format(value)));
  }
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  svg.append(svgElement('polygon', { points: `${x(0)},${y(0)} ${points} ${x(values.length - 1)},${y(0)}`, class: 'area' }));
  svg.append(svgElement('polyline', { points, class: 'line' }));
  values.forEach((value, index) => {
    const point = svgElement('circle', { cx: x(index), cy: y(value), r: values.length < 15 ? 4 : 2, class: 'point' });
    point.append(svgElement('title', {}, `${daily[index].day}: ${format.format(value)} ${metricNames[metric].toLowerCase()}`));
    svg.append(point);
  });
  const indices = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];
  for (const index of indices) {
    svg.append(svgElement('text', { x: x(index), y: height - 10, 'text-anchor': index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle' }, daily[index].day));
  }
  chart.append(svg);
}

function render(data) {
  if (!data || typeof data.totals !== 'object' || !data.totals || !data.consent || !['daily', 'versions', 'platforms', 'features', 'errors'].every((key) => Array.isArray(data[key]))) {
    throw new Error('The analytics response was incomplete. Refresh to try again.');
  }
  daily = data.daily.filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(row.day)).sort((a, b) => a.day.localeCompare(b.day));
  for (const key of ['activeInstallations', 'events', 'callsStarted', 'callsCompleted', 'durationMinutes', 'installations']) byId(key).textContent = format.format(count(data.totals[key]));
  byId('accepted').textContent = format.format(count(data.consent.accepted));
  byId('analyticsEnabled').textContent = format.format(count(data.consent.analyticsEnabled));
  byId('consent-versions').textContent = `Terms version: ${data.consent.termsVersion || 'Not recorded'}. Privacy version: ${data.consent.privacyVersion || 'Not recorded'}.`;
  for (const [id, key, empty] of [
    ['versions', 'version', 'No version events for these filters.'],
    ['platforms', 'platform', 'No platform events for these filters.'],
    ['features', 'feature', 'No feature events for these filters.'],
    ['errors', 'errorCode', 'No reported error events for these filters.']
  ]) table(id, data[id].filter((row) => row && typeof row === 'object'), [(row) => String(row[key] || 'Unknown'), (row) => format.format(count(row.events))], empty);
  table('daily', daily, [(row) => row.day, ...Object.keys(metricNames).map((key) => (row) => format.format(count(row[key])))], 'No daily activity for these filters.');
  options('version', data.versions, 'version', knownVersions);
  options('platform', data.platforms, 'platform', knownPlatforms);
  drawChart();
  byId('results').hidden = false;
  byId('status').hidden = count(data.totals.events) > 0;
  byId('status').textContent = 'No analytics events for these filters. Try a longer period or another version or platform. Consent records can still be present.';
}

async function refresh() {
  const current = ++request;
  if (controller) controller.abort();
  controller = new AbortController();
  const activeController = controller;
  const query = params();
  byId('export').href = `/api/export.csv?${query}`;
  byId('status').hidden = false;
  byId('status').className = 'status';
  byId('status').textContent = 'Loading analytics…';
  byId('results').hidden = true;
  byId('updated').textContent = '';
  byId('main').setAttribute('aria-busy', 'true');
  const timeout = setTimeout(() => activeController.abort(), 20000);
  try {
    const response = await fetch(`/api/stats?${query}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: activeController.signal });
    if (current !== request) return;
    if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Your private workspace session has expired. Reload this page to sign in, then refresh analytics.');
    if (!response.ok) throw new Error(`Analytics could not be loaded (HTTP ${response.status}). Use Refresh to try again.`);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The server did not return analytics. Reload this page to check your private workspace session.');
    const data = await response.json();
    if (current !== request) return;
    render(data);
    byId('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (current !== request) return;
    byId('results').hidden = true;
    byId('status').hidden = false;
    byId('status').className = 'status error';
    byId('status').textContent = error.name === 'AbortError' ? 'Analytics took too long to load. Use Refresh to try again.' : error instanceof TypeError ? 'Could not connect to analytics. Check your connection and use Refresh to try again.' : error.message;
  } finally {
    clearTimeout(timeout);
    if (current === request) byId('main').removeAttribute('aria-busy');
  }
}

byId('filters').addEventListener('submit', (event) => { event.preventDefault(); refresh(); });
for (const id of ['days', 'version', 'platform']) byId(id).addEventListener('change', refresh);
byId('metric').addEventListener('change', drawChart);
refresh();
