// Официальный MCP-рефери против нашего endpoint. Набор заморожен ревизией 2026-07-28
// (--requirements), как у апстрима: сценарии не выбираем вручную, берём то, что требует спека.
//
// Запуск: pnpm test:mcp          (отчёт + ratchet по baseline)
//         pnpm test:mcp:report   (только отчёт, без assert на код возврата)
//
// Baseline: src/mcp/tests/expected-failures.yaml — список сценариев, которые мы пока не закрываем.
// Рефери сам падает на STALE-записях (сценарий из списка начал проходить) — значит список
// нельзя тихо устареть: закрыл пробел → убери строку. Так набор становится ratchet'ом.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpServer, type McpTestServer } from './harness';

const REFEREE = join(process.cwd(), 'node_modules/@modelcontextprotocol/conformance/dist/index.js');
const REQUIREMENTS = '2026-07-28';
const BASELINE = join(process.cwd(), 'src/mcp/tests/expected-failures.yaml');
const REPORT_ONLY = process.env.MCP_CONFORMANCE_REPORT === '1';

let server: McpTestServer | undefined;

beforeAll(async () => {
  server = await startMcpServer();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

function referee(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REFEREE, ...args], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe(`MCP conformance · официальный рефери · frozen ${REQUIREMENTS}`, () => {
  it(
    'прогоняет требуемые спекой сценарии против chord endpoint',
    async () => {
      const out = mkdtempSync(join(tmpdir(), 'chord-mcp-conformance-'));
      const args = ['server', '--url', server!.url, '--requirements', REQUIREMENTS, '--timeout', '8000', '-o', out];
      if (!REPORT_ONLY && existsSync(BASELINE)) args.push('--expected-failures', BASELINE);

      const run = await referee(args);
      console.log(run.stdout);
      if (run.stderr.trim()) console.error(run.stderr);
      console.log('[conformance] результаты:', out, readdirSync(out).join(', '));
      for (const file of readdirSync(out)) {
        if (!file.endsWith('.json')) continue;
        const parsed = JSON.parse(readFileSync(join(out, file), 'utf8'));
        console.log(`[conformance] ${file}:`, JSON.stringify(parsed).slice(0, 4000));
      }

      if (REPORT_ONLY) {
        expect(run.stdout.length + run.stderr.length).toBeGreaterThan(0);
        return;
      }
      expect(run.code, `рефери завершился с кодом ${run.code}`).toBe(0);
    },
    900_000,
  );
});
