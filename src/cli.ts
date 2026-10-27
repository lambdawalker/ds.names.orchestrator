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
import {readVault} from './vault.js';
import {readSecret} from './secret-input.js';
import {startServices} from './services.js';
import {readConfigFile} from './yaml-config.js';
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
  const config = ConfigSchema.parse(await readConfigFile(command.config));
  const names = parseNames(await readFile(command.names, 'utf8'));
  const credentials=await readVault(config.vaultFile,await readSecret('Vault passphrase: '));
  const startup=new AbortController();const startupCancel=()=>startup.abort();process.once('SIGINT',startupCancel);process.once('SIGTERM',startupCancel);
  let fleet:Awaited<ReturnType<typeof startServices>>|undefined;
  try {fleet=await startServices(config.services,credentials,startup.signal);
  config.store.baseUrl=fleet.endpoints.store??config.store.baseUrl;
  const store = new StorageClient(config.store.baseUrl, credentials.store ?? '');
  if (command.command === 'status') {
    for (const name of names) {
      if(startup.signal.aborted)break;
      const receipt = await store.getTask(taskId(name));
      console.log(JSON.stringify({ input: name, task_id: taskId(name), status: receipt?.task.status ?? 'not_started', stats: receipt?.task.stats, result: receipt ? checkpointOf(receipt).result : undefined, note: receipt?.task.note }));
    }
    return startup.signal.aborted?130:0;
  }
  if (command.retryStopped) for (const name of names) {
    const receipt = await store.getTask(taskId(name));
    if (receipt && ['failed', 'budget_stopped'].includes(receipt.task.status)) {
      const cp = checkpointOf(receipt); cp.elapsed_ms = 0; delete cp.active_since;
      await store.saveTask({ ...receipt.task, checkpoint: cp, status: 'pending', session_ids: [], stats: { sessions: 0, model_calls: 0, tool_calls: 0 }, note: 'Operator explicitly reset stopped-run budgets; retained evidence and pending submission preserved.' }, receipt.revision);
    }
  }
  const controller = startup; const cancel = startupCancel;
  try {
    const results = await runNames(names, config, store, createHarnessSession({...config,store:{baseUrl:fleet.endpoints.store??config.store.baseUrl}}, credentials.store!, controller.signal,credentials.model??'local-unused',fleet.endpoints.wiktionary?fleet.connection('wiktionary'):undefined), controller.signal);
    for (const result of results) console.log(JSON.stringify(result));
    if (controller.signal.aborted) return 130;
    return results.some(r => ['failed', 'budget_stopped'].includes(r.status)) ? 2 : 0;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  } catch(error){if(startup.signal.aborted)return 130;throw error;} finally {process.removeListener('SIGINT',startupCancel);process.removeListener('SIGTERM',startupCancel);await fleet?.close();for(const key of Object.keys(credentials))delete credentials[key];}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof z.ZodError ? 'Configuration or input validation failed; check the documented schema.' : error instanceof Error ? error.message : 'Research failed'); process.exitCode = 1; }
}
