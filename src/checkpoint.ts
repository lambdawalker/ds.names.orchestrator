import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FindingSchema, type ResearchTaskReceipt } from '@lambdawalker/names-research-store/contracts';
import { NameInputSchema, type NameInput } from './config.js';
import type { StorageClient } from './store-client.js';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const SectionSchema = z.object({ title: z.string().max(160), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const DocumentRefSchema = z.object({ document_id: z.string(), source_id: z.string(), title: z.string().max(256), language: z.string().max(128).optional(), locator: z.string().max(4096), sections: z.array(SectionSchema).max(10), section_count: z.number().int(), total_units: z.number().int() });
export const ResultSchema = z.object({ status: z.literal('review_required'), origin_id: z.string(), subject_form_id: z.string(), root_form_id: z.string(), finding_id: z.string().optional() });
export const CheckpointSchema = z.object({ version: z.literal(1), elapsed_ms: z.number().nonnegative().default(0), lookup_attempts: z.number().int().nonnegative().default(0), active_since: z.number().nonnegative().optional(), documents: z.array(DocumentRefSchema).max(8), fragments: z.array(z.object({ fragment_id: z.string(), document_id: z.string() })).max(40), pending: z.object({ finding: FindingSchema, result: ResultSchema }).optional(), result: ResultSchema.optional() });
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const checkpointOf = (receipt: ResearchTaskReceipt): Checkpoint => CheckpointSchema.parse(receipt.task.checkpoint);
export const terminal = (status: string) => ['review_required', 'unresolved', 'budget_stopped', 'failed'].includes(status);
export function taskId(input: NameInput) { const name = NameInputSchema.parse(input); return 'root-v1-' + hash([name.name, name.language ?? null]); }
export async function ensureTask(store: StorageClient, input: NameInput): Promise<ResearchTaskReceipt> {
  const name = NameInputSchema.parse(input); const id = taskId(name); const existing = await store.getTask(id);
  if (existing) { checkpointOf(existing); return existing; }
  return store.saveTask({ id, input: name, phase: 'root', status: 'pending', checkpoint: { version: 1, documents: [], fragments: [] }, finding_ids: [], session_ids: [], stats: { sessions: 0, model_calls: 0, tool_calls: 0 } }, 0, id);
}
