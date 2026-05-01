#!/usr/bin/env node
/**
 * Smoke test: spawn the MCP server, send tools/list and a detect_project
 * call over stdio, validate the responses, and exit.
 *
 * No external test framework — keeps the package's runtime dep surface small.
 */

const { spawn } = require('child_process');
const path = require('path');

const SERVER_BIN = path.join(__dirname, '..', 'src', 'mcp.js');

function main() {
  const child = spawn(process.execPath, [SERVER_BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  const pending = new Map();
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        fail(`Non-JSON on stdout: ${line}`);
      }
      const handler = pending.get(msg.id);
      if (handler) {
        pending.delete(msg.id);
        handler(msg);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[mcp stderr] ${chunk}`);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      fail(`server exited with code ${code}`);
    }
  });

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) => {
        if (msg.error) reject(new Error(`${method} error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      const payload = { jsonrpc: '2.0', id, method, params };
      child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  function fail(msg) {
    console.error(`SMOKE FAIL: ${msg}`);
    child.kill();
    process.exit(1);
  }

  (async () => {
    try {
      // 1. Initialize handshake
      await send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '0.0.0' },
      });

      // 2. List tools
      const tools = await send('tools/list', {});
      const names = (tools.tools || []).map((t) => t.name).sort();
      const expected = ['detect_project', 'install_vaultcms', 'list_presets'];
      const ok = expected.every((n) => names.includes(n));
      if (!ok) fail(`tools/list missing expected tools. got=${names.join(',')}`);
      console.log(`✓ tools/list returned: ${names.join(', ')}`);

      // 3. Call detect_project on the package's own repo (we know it has package.json + .git but no Astro config)
      const detect = await send('tools/call', {
        name: 'detect_project',
        arguments: { path: path.join(__dirname, '..') },
      });
      const detectText = detect?.content?.[0]?.text;
      if (!detectText) fail('detect_project returned no content');
      const parsed = JSON.parse(detectText);
      if (parsed.exists !== true) fail('detect_project: expected exists=true');
      if (parsed.hasPackageJson !== true) fail('detect_project: expected hasPackageJson=true');
      console.log(`✓ detect_project: projectRoot=${parsed.projectRoot}, isAstroProject=${parsed.isAstroProject}`);

      console.log('\nAll smoke checks passed.');
      child.kill();
      process.exit(0);
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
  })();
}

main();
