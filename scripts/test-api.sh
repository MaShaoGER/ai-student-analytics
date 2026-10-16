#!/usr/bin/env bash
# Start an isolated HTTP test server: no real accounts, settings or provider calls.
set -euo pipefail
node --input-type=module <<'JS'
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'analytics-http-test-'));
const port = process.env.API_TEST_PORT || '3100';
const base = `http://localhost:${port}`;
const username = 'http.test.admin';
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, DEMO_DATA_DIR: 'data/fixtures/golden', APP_STATE_DIR: directory, ANALYSIS_RECORDS_DIR: join(directory, 'analysis-records'), APP_ORIGIN: base, ADMIN_USERNAME: username, ADMIN_PASSWORD: password,
  APP_SETTINGS_KEY: randomBytes(32).toString('base64'), OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_INPUT_PRICE: '', OPENAI_OUTPUT_PRICE: '',
  API_TEST_USERNAME: username, API_TEST_PASSWORD: password, API_BASE_URL: base, API_INTEGRATION: '1', NEXT_TELEMETRY_DISABLED: '1' };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', port], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const tests = spawn('pnpm', ['exec', 'vitest', 'run', 'lib/api/api-integration.test.ts'], { env, stdio: 'inherit' });
  process.exitCode = await new Promise(resolve => tests.on('exit', code => resolve(code ?? 1)));
} catch (error) {
  console.error(error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  const stopped = exited ? Promise.resolve() : new Promise(resolve => server.on('exit', resolve));
  stop();
  await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 4000))]);
  if (!exited) server.kill('SIGKILL');
  rmSync(directory, { recursive: true, force: true });
}
JS
