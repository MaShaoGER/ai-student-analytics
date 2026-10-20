#!/usr/bin/env bash
# Start an isolated HTTP test server: no real accounts, settings or provider calls.
set -euo pipefail
node --input-type=module <<'JS'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'analytics-http-test-'));
const demoDirectory = join(directory, 'demo');
cpSync('data/fixtures/golden', demoDirectory, { recursive: true });
// Keep golden aggregates intact; extended studio columns are unknown (NULL), not invented values.
const outcomesPath = join(demoDirectory, 'student_outcomes.csv');
const outcomeLines = readFileSync(outcomesPath, 'utf8').trimEnd().split('\n');
outcomeLines[0] += ',attendance_rate,homework_completion_rate,absent_sessions,scheduled_sessions,excused_sessions';
for (let index = 1; index < outcomeLines.length; index++) outcomeLines[index] += ',,,,,';
writeFileSync(outcomesPath, outcomeLines.join('\n') + '\n');
const originalTsconfig = readFileSync('tsconfig.json', 'utf8');
const originalNextEnv = readFileSync('next-env.d.ts', 'utf8');
const port = process.env.API_TEST_PORT || '3100';
const base = `http://localhost:${port}`;
const username = 'http.test.admin';
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, NEXT_DIST_DIR: '.next/api-test', DEMO_DATA_DIR: demoDirectory, APP_STATE_DIR: directory, ANALYSIS_RECORDS_DIR: join(directory, 'analysis-records'), APP_ORIGIN: base, ADMIN_USERNAME: username, ADMIN_PASSWORD: password,
  APP_SETTINGS_KEY: randomBytes(32).toString('base64'), OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_INPUT_PRICE: '', OPENAI_OUTPUT_PRICE: '',
  API_TEST_USERNAME: username, API_TEST_PASSWORD: password, API_BASE_URL: base, API_INTEGRATION: '1', NEXT_TELEMETRY_DISABLED: '1' };
const startServer = () => spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', port], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let server = startServer();
let logs = '';
server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
let exited = false;
server.on('exit', () => { exited = true; });
function stop() { server.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (exited) throw new Error('HTTP test server failed to start.');
    try { const response = await fetch(`${base}/api/auth/session`); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('HTTP test server did not become ready.');
  console.log('HTTP tests use isolated accounts and settings; AI provider calls are disabled.');
  const tests = spawn('pnpm', ['exec', 'vitest', 'run', 'lib/api/api-integration.test.ts', 'lib/api/admin-integration.test.ts', 'lib/api/grade-import-integration.test.ts', '--no-file-parallelism'], { env, stdio: 'inherit' });
  process.exitCode = await new Promise(resolve => tests.on('exit', code => resolve(code ?? 1)));
  if (process.exitCode === 0) {
    const api = async (route, cookie, body, method = body ? 'POST' : 'GET') => fetch(base + route, { method, headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const signIn = async (name, pass) => { const response = await api('/api/auth/login', '', { username: name, password: pass }); assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0]; };
    const adminCookie = await signIn(username, password);
    const restartName = 'restart.fixture';
    const restartPassword = randomBytes(24).toString('base64url');
    const created = await api('/api/admin/users', adminCookie, { username: restartName, displayName: '重启恢复验收', password: restartPassword, role: 'readonly', datasetIds: ['demo'] });
    assert.equal(created.status, 201);
    const { user: restartUser } = await created.json();
    const restartCookie = await signIn(restartName, restartPassword);
    assert.equal((await api('/api/admin/users', adminCookie, { id: restartUser.id, datasetIds: [] }, 'PATCH')).status, 200);
    assert.equal((await api('/api/admin/datasets', adminCookie, { id: 'oulad', enabled: false }, 'PATCH')).status, 200);
    const beforeConfig = (await (await api('/api/admin/ai-config', adminCookie)).json()).config;
    const imported = (await (await api('/api/admin/datasets', adminCookie)).json()).datasets.find(item => item.id.startsWith('grades_'));
    assert.ok(imported, 'Published grades must exist before restart.');
    const gradePlan = {version:1,datasetId:imported.id,metric:'score',aggregation:'avg',dimensions:['course'],filters:[],chartType:'bar'};
    if (!imported.enabled) assert.equal((await api('/api/admin/datasets', adminCookie, {id:imported.id,enabled:true}, 'PATCH')).status,200);
    const beforeGrades = (await (await api('/api/analysis', adminCookie, gradePlan)).json()).result;
    assert.ok(beforeGrades?.datasetVersion);

    const stopped = new Promise(resolve => server.once('exit', resolve));
    stop();
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 4000))]);
    if (!exited) { server.kill('SIGKILL'); await stopped; }
    exited = false;
    server = startServer();
    server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
    server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
    server.on('exit', () => { exited = true; });
    let restarted = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (exited) throw new Error('Restart verification server exited.');
      try { if ((await fetch(base + '/api/auth/session')).ok) { restarted = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(restarted, 'Isolated restart timed out.');
    const recoveredSession = await (await api('/api/auth/session', restartCookie)).json();
    assert.equal(recoveredSession.user.role, 'readonly');
    assert.deepEqual(recoveredSession.user.datasetIds, []);
    assert.deepEqual(await (await api('/api/profile', restartCookie)).json(), { datasets: [] });
    const recoveredDatasets = await (await api('/api/admin/datasets', adminCookie)).json();
    assert.equal(recoveredDatasets.datasets.find(item => item.id === 'oulad').enabled, false);
    assert.deepEqual((await (await api('/api/admin/ai-config', adminCookie)).json()).config, beforeConfig);
    const afterGrades = (await (await api('/api/analysis', adminCookie, gradePlan)).json()).result;
    assert.deepEqual(afterGrades.rows, beforeGrades.rows);
    assert.equal(afterGrades.datasetVersion,beforeGrades.datasetVersion);
    const publicationLogs = await (await api('/api/admin/logs?action=dataset.publish',adminCookie)).json();
    assert.ok(publicationLogs.events.some(event => event.targetId===imported.id));

    const recoveredLogs = await (await api('/api/admin/logs?action=user.update', adminCookie)).json();
    assert.ok(recoveredLogs.events.some(event => event.targetId === restartUser.id));
    console.log('Isolated restart passed: sessions, readonly role, revoked grants, dataset status, AI config, imported grade versions and atomic admin audit recovered.');
  }

} catch (error) {
  console.error(error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  const stopped = exited ? Promise.resolve() : new Promise(resolve => server.on('exit', resolve));
  stop();
  await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 4000))]);
  if (!exited) server.kill('SIGKILL');
  // Next writes dist-specific type includes. Restore only those generated changes,
  // never concurrent edits to the user's compiler configuration.
  const currentTsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  const originalConfig = JSON.parse(originalTsconfig);
  const originalIncludes = originalConfig.include || [];
  currentTsconfig.include = (currentTsconfig.include || []).filter(value =>
    !value.startsWith('.next/api-test/') || originalIncludes.includes(value));
  if (JSON.stringify(currentTsconfig) === JSON.stringify(originalConfig)) writeFileSync('tsconfig.json', originalTsconfig);
  if (readFileSync('next-env.d.ts', 'utf8').includes('.next/api-test/')) writeFileSync('next-env.d.ts', originalNextEnv);
  rmSync(directory, { recursive: true, force: true });
}
JS
