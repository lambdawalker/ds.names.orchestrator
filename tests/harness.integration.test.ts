import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { ensureTask } from '../src/checkpoint.js';
import { ResearchTools } from '../src/research-tools.js';
import { createHarnessSession } from '../src/harness.js';
import { runNames } from '../src/runner.js';
import { fixture, proposal } from './helpers.js';

it('runs the actual Harness and stdio MCP against a local scripted model, with only four allowed tools', async () => {
  const f = await fixture(); const requests: Record<string, unknown>[] = []; let calls = 0;
  const task = await ensureTask(f.storage, { name: 'John', language: 'English' });
  const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
  const doc = await tools.lookup({ title: 'John', language: 'English' });
  const section = doc.sections.find(s => s.title === 'Etymology')!;
  const citation = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
  const model = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body); calls++;
    const delta = calls === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'root_call_1', type: 'function', function: { name: 'mcp__names__submit_root', arguments: JSON.stringify(proposal(citation.fragment_id)) } }] } : { role: 'assistant', content: 'Candidate root saved with source evidence.' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'test-response', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'test-response', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve)); const address = model.address();
  if (!address || typeof address === 'string') throw Error('listen');
  try {
    const config = { ...f.config, model: { ...f.config.model, baseUrl: `http://127.0.0.1:${address.port}/v1` } };
    const results = await runNames([{ name: 'John', language: 'English' }], config, f.storage, createHarnessSession(config, 'synthetic-test-token-'.repeat(3)));
    expect(results[0]?.status).toBe('review_required'); expect(calls).toBeGreaterThan(0);
    const advertised = requests[0]!.tools as { function: { name: string } }[];
    expect(advertised.map(t => t.function.name).sort()).toEqual(['mcp__names__finish_unresolved', 'mcp__names__lookup_name', 'mcp__names__read_evidence', 'mcp__names__submit_root']);
    expect(JSON.stringify(requests)).not.toContain('synthetic-test-token-');
    expect(f.store.status().findings).toBe(1);
  } finally { await new Promise<void>(resolve => model.close(() => resolve())); await f.close(); }
}, 90000);
it.each([{ steps: 1, promptTokens: 100 }, { steps: 6, promptTokens: 15000 }])('admits no excess requests at a step cap or high context pressure ($steps steps)', async ({ steps, promptTokens }) => {
  const f = await fixture(); let calls = 0;
  const model = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume */ } calls++;
    const chunk = { id: 'loop', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'loop-' + calls, type: 'function', function: { name: 'mcp__names__read_evidence', arguments: JSON.stringify({ document_id: 'a'.repeat(64), offset: 0, limit: 10 }) } }] }, finish_reason: null }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: promptTokens, completion_tokens: 20, total_tokens: promptTokens + 20 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve)); const address = model.address(); if (!address || typeof address === 'string') throw Error('listen');
  try {
    const config = { ...f.config, model: { ...f.config.model, baseUrl: `http://127.0.0.1:${address.port}/v1` }, budgets: { ...f.config.budgets, maxSessions: 1, maxSessionSteps: steps } };
    const results = await runNames([{ name: 'Loop' }], config, f.storage, createHarnessSession(config, 'synthetic-test-token-'.repeat(3)));
    expect(calls).toBe(1); expect(results[0]!.status).toBe('budget_stopped');
  } finally { await new Promise<void>(resolve => model.close(() => resolve())); await f.close(); }
}, 90000);
