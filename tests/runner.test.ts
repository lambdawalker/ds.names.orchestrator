import { expect, it } from 'vitest';
import { runNames } from '../src/runner.js';
import { ensureTask, checkpointOf } from '../src/checkpoint.js';
import { fixture } from './helpers.js';
it('uses fresh sessions between names and bounded continuations, then skips terminal tasks on rerun', async () => {
  const f = await fixture(); try {
    const seen: { task: string; session: string; prompt: string }[] = [];
    const factory = async (context: { taskId: string; sessionId: string; prompt: string }) => {
      seen.push({ task: context.taskId, session: context.sessionId, prompt: context.prompt });
      if (seen.filter(s => s.task === context.taskId).length === 2) {
        const receipt = (await f.storage.getTask(context.taskId))!;
        await f.storage.saveTask({ ...receipt.task, status: 'unresolved', note: 'No evidence found in test' }, receipt.revision);
      }
      return { modelCalls: 1, stopped: false };
    };
    const results = await runNames([{ name: 'John' }, { name: 'Mary' }], f.config, f.storage, factory);
    expect(results.map(r => r.status)).toEqual(['unresolved', 'unresolved']); expect(seen).toHaveLength(4);
    expect(new Set(seen.map(s => s.session)).size).toBe(4);
    expect(seen.filter(s => s.task === results[1]!.task_id).every(s => !s.prompt.includes('John'))).toBe(true);
    await runNames([{ name: 'John' }], f.config, f.storage, factory); expect(seen).toHaveLength(4);
  } finally { await f.close(); }
});
it('charges an interrupted session against its durable wall-time budget on resume', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'Interrupted' });
    await f.storage.saveTask({ ...task.task, status: 'running', checkpoint: { ...checkpointOf(task), active_since: Date.now() - f.config.budgets.maxNameMs - 1000, elapsed_ms: 0 } }, task.revision);
    const results = await runNames([{ name: 'Interrupted' }], f.config, f.storage, async () => { throw Error('must not launch'); });
    expect(results[0]!.status).toBe('budget_stopped');
  } finally { await f.close(); }
});
it('persists exhausted budgets and never treats an empty model answer as a saved root', async () => {
  const f = await fixture(); try {
    const config = { ...f.config, budgets: { ...f.config.budgets, maxSessions: 1 } };
    const results = await runNames([{ name: 'Unknown' }], config, f.storage, async () => ({ modelCalls: 1, stopped: false }));
    expect(results[0]!.status).toBe('budget_stopped'); expect(f.store.status().findings).toBe(0);
    await runNames([{ name: 'Unknown' }], config, f.storage, async () => { throw Error('must not rerun'); });
  } finally { await f.close(); }
});
