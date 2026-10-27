#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConfigSchema, NameInputSchema, type NameInput } from './config.js';
import { StorageClient } from './store-client.js';
import { runNames } from './runner.js';
import { createHarnessSession } from './harness.js';
import { checkpointOf, taskId } from './checkpoint.js';
export function parseNames(raw: string): NameInput[] {
  if (Buffer.byteLength(raw) > 1048576) throw Error('Names file exceeds 1 MiB');
  return z.array(z.union([z.string(), NameInputSchema])).min(1).max(1000).parse(JSON.parse(raw)).map(n => NameInputSchema.parse(typeof n === 'string' ? { name: n } : n));
}
export function parseCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { config: { type: 'string' }, names: { type: 'string' }, 'retry-stopped': { type: 'boolean' } }, strict: true });
  if (positionals.length !== 1 || !['run', 'status'].includes(positionals[0]!) || !values.config || !values.names) throw Error('Usage: npm start -- run|status --config config.json --names names.json [--retry-stopped]');
  if (positionals[0] === 'status' && values['retry-stopped']) throw Error('--retry-stopped is only valid for run');
  return { command: positionals[0]!, config: values.config, names: values.names, retryStopped: values['retry-stopped'] ?? false };
}
export async function main(args: string[]) {
  const command = parseCommand(args);
  const config = ConfigSchema.parse(JSON.parse(await readFile(command.config, 'utf8')));
  const names = parseNames(await readFile(command.names, 'utf8'));
  const store = new StorageClient(config.store.baseUrl, process.env.STORE_API_TOKEN ?? '');
  if (command.command === 'status') {
    for (const name of names) {
      const receipt = await store.getTask(taskId(name));
      console.log(JSON.stringify({ input: name, task_id: taskId(name), status: receipt?.task.status ?? 'not_started', stats: receipt?.task.stats, result: receipt ? checkpointOf(receipt).result : undefined, note: receipt?.task.note }));
    }
    return 0;
  }
  if (command.retryStopped) for (const name of names) {
    const receipt = await store.getTask(taskId(name));
    if (receipt && ['failed', 'budget_stopped'].includes(receipt.task.status)) {
      const cp = checkpointOf(receipt); cp.elapsed_ms = 0; delete cp.active_since;
      await store.saveTask({ ...receipt.task, checkpoint: cp, status: 'pending', session_ids: [], stats: { sessions: 0, model_calls: 0, tool_calls: 0 }, note: 'Operator explicitly reset stopped-run budgets; retained evidence and pending submission preserved.' }, receipt.revision);
    }
  }
  const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const results = await runNames(names, config, store, createHarnessSession(config, process.env.STORE_API_TOKEN!, controller.signal), controller.signal);
    for (const result of results) console.log(JSON.stringify(result));
    if (controller.signal.aborted) return 130;
    return results.some(r => ['failed', 'budget_stopped'].includes(r.status)) ? 2 : 0;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof z.ZodError ? 'Configuration or input validation failed; check the documented schema.' : error instanceof Error ? error.message : 'Research failed'); process.exitCode = 1; }
}
