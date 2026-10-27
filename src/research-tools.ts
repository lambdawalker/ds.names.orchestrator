import { z } from 'zod';
import { FormSchema, formIdentity, FindingSchema, type Form } from '@lambdawalker/names-research-store/contracts';
import { toDocumentInput, type WiktionaryClient } from '@lambdawalker/names-api-wiktionary';
import type { Config } from './config.js';
import type { StorageClient } from './store-client.js';
import { checkpointOf, hash, terminal, type Checkpoint } from './checkpoint.js';

const FormDraft = FormSchema.omit({ id: true });
export const toolSchemas = {
  lookup_name: z.strictObject({ title: z.string().trim().min(1).max(256), language: z.string().trim().min(1).max(128).optional() }),
  read_evidence: z.strictObject({ document_id: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0), limit: z.number().int().min(1).max(4000).default(2000) }),
  submit_root: z.strictObject({ subject: FormDraft.omit({ spelling: true, reconstructed: true, transliterations: true }), root: FormDraft, citation_ids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(3), meaning: z.string().trim().min(1).max(512).optional(), meaning_language: z.string().trim().min(1).max(128).optional(), interpretation: z.string().trim().min(1).max(1500) }).refine(x => !x.meaning || !!x.meaning_language, 'Meaning requires its translation language'),
  finish_unresolved: z.strictObject({ reason: z.string().trim().min(1).max(1500) }),
};
function assertCheckpointBudget(checkpoint: Checkpoint) {
  const { pending, ...metadata } = checkpoint;
  if (Buffer.byteLength(JSON.stringify(metadata)) > 16384) throw Error('Checkpoint metadata budget reached; use admitted citations to submit a root or finish unresolved');
  if (pending && Buffer.byteLength(JSON.stringify(pending)) > 12288) throw Error('Candidate payload exceeds checkpoint budget; shorten interpretation or optional details');
}
export async function recoverPending(store: StorageClient, taskId: string) {
  const receipt = await store.getTask(taskId); if (!receipt) throw Error('Research task missing');
  const cp = checkpointOf(receipt); if (!cp.pending) return receipt;
  const result = z.object({ finding_id: z.string() }).parse(await store.call('record_finding', cp.pending.finding));
  const completed = { ...cp.pending.result, finding_id: result.finding_id };
  const checkpoint: Checkpoint = { ...cp, result: completed }; delete checkpoint.pending;
  return store.saveTask({ ...receipt.task, status: 'review_required', checkpoint, finding_ids: [...new Set([...receipt.task.finding_ids, result.finding_id])] }, receipt.revision);
}
export class ResearchTools {
  constructor(private store: StorageClient, private wiki: Pick<WiktionaryClient, 'getPage'>, private taskId: string, private config: Config) {}
  private async enter() {
    const receipt = await recoverPending(this.store, this.taskId);
    if (terminal(receipt.task.status)) throw Error(`Task is terminal: ${receipt.task.status}`);
    if (receipt.task.stats.tool_calls >= this.config.budgets.maxTools) throw Error('Research tool budget exhausted');
    return this.store.saveTask({ ...receipt.task, status: 'running', stats: { ...receipt.task.stats, tool_calls: receipt.task.stats.tool_calls + 1 } }, receipt.revision);
  }
  async lookup(input: unknown) {
    const args = toolSchemas.lookup_name.parse(input); let receipt = await this.enter(); const cp = checkpointOf(receipt);
    const existing = cp.documents.find(d => d.title === args.title.normalize('NFC') && d.language === args.language);
    if (existing) return { ...existing, preview: await this.preview(existing.document_id, existing.sections) };
    if (cp.lookup_attempts >= this.config.budgets.maxLookups) throw Error('Source lookup budget exhausted');
    cp.lookup_attempts++;
    receipt = await this.store.saveTask({ ...receipt.task, checkpoint: cp }, receipt.revision);
    const page = await this.wiki.getPage(args.title, { edition: 'en', language: args.language });
    const payload = toDocumentInput(page);
    const doc = z.object({ document_id: z.string() }).parse(await this.store.call('store_document', payload));
    const sections = page.data.sections.filter(s => /etymology/i.test(s.title)).slice(0, 10).map(s => ({ title: s.title.slice(0, 160), start: s.start, end: s.end }));
    const ref = { document_id: doc.document_id, source_id: payload.source.id, title: args.title.normalize('NFC'), ...(args.language ? { language: args.language } : {}), locator: page.locator, sections, section_count: page.data.sections.length, total_units: page.data.markdown.length };
    const checkpoint = { ...cp, documents: [...cp.documents, ref] }; assertCheckpointBudget(checkpoint);
    await this.store.saveTask({ ...receipt.task, checkpoint }, receipt.revision);
    return { ...ref, preview: await this.preview(ref.document_id, sections) };
  }
  private async preview(document_id: string, sections: { start: number }[]) {
    return z.object({ text: z.string() }).parse(await this.store.call('read_document', { document_id, offset: sections[0]?.start ?? 0, limit: 2000 })).text;
  }
  async read(input: unknown) {
    const args = toolSchemas.read_evidence.parse(input); const receipt = await this.enter(); const cp = checkpointOf(receipt);
    const doc = cp.documents.find(d => d.document_id === args.document_id); if (!doc) throw Error('Document was not admitted to this task');
    if (args.offset >= doc.total_units) throw Error('Evidence offset is outside document');
    if (cp.fragments.length >= 40) throw Error('Fragment budget exhausted');
    const fragment = z.object({ fragment_id: z.string(), document_id: z.string(), text: z.string(), start: z.number(), end: z.number() }).parse(await this.store.call('create_fragment', { document_id: args.document_id, start: args.offset, end: Math.min(doc.total_units, args.offset + args.limit) }));
    const ref = { fragment_id: fragment.fragment_id, document_id: doc.document_id };
    const checkpoint = { ...cp, fragments: [...cp.fragments.filter(f => f.fragment_id !== ref.fragment_id), ref] }; assertCheckpointBudget(checkpoint);
    await this.store.saveTask({ ...receipt.task, checkpoint }, receipt.revision);
    return { ...fragment, source_id: doc.source_id, locator: doc.locator };
  }
  async submit(input: unknown) {
    const args = toolSchemas.submit_root.parse(input); const receipt = await this.enter(); const cp = checkpointOf(receipt);
    const languageHint = receipt.task.input.language?.toLowerCase();
    if (languageHint && ![args.subject.language.code.toLowerCase(), args.subject.language.name.toLowerCase()].includes(languageHint)) throw Error('Subject language must match task language');
    const citations = [...new Set(args.citation_ids)].map(id => { const f = cp.fragments.find(f => f.fragment_id === id); const doc = f && cp.documents.find(d => d.document_id === f.document_id); if (!f || !doc) throw Error('Citation was not admitted to this task'); return { ...f, source_id: doc.source_id, locator: doc.locator }; });
    const passages = await Promise.all(citations.map(async c => z.object({ text: z.string() }).parse(await this.store.call('get_fragment', { fragment_id: c.fragment_id })).text));
    if (!passages.some(s => s.normalize('NFC').includes(args.root.spelling.normalize('NFC')))) throw Error('Root spelling must be present in a cited passage');
    const resolveForm = async (draft: z.infer<typeof FormDraft>): Promise<Form> => {
      const form = FormSchema.parse({ ...draft, id: 'pending' }); form.id = 'form-' + hash(formIdentity(form));
      return FormSchema.nullable().parse(await this.store.call('get_form_by_identity', form)) ?? form;
    };
    const subject = await resolveForm({ ...args.subject, spelling: receipt.task.input.name, reconstructed: false, transliterations: [] });
    const root = await resolveForm(args.root);
    const evidence = citations.map(c => ({ id: 'evidence-' + hash([this.taskId, c.fragment_id]), source_id: c.source_id, document_id: c.document_id, fragment_id: c.fragment_id, locator: c.locator, note: 'Verbatim source fragment retained with checksum; candidate interpretation requires review.' }));
    const origin = { id: 'origin-' + hash([this.taskId, root.id, evidence.map(e => e.id), args.meaning ?? null]), subject_form_id: subject.id, root_form_id: root.id, original_variation_ids: [], status: 'candidate', evidence_ids: evidence.map(e => e.id), interpretation: args.interpretation, ...(args.meaning ? { meaning: args.meaning, meaning_language: args.meaning_language } : {}) };
    const finding = FindingSchema.parse({ idempotency_key: 'root-' + hash([this.taskId, origin.id]), forms: [...new Map([subject, root].map(f => [f.id, f])).values()], evidence, origins: [origin] });
    const result = { status: 'review_required' as const, origin_id: origin.id, subject_form_id: subject.id, root_form_id: root.id };
    const checkpoint = { ...cp, pending: { finding, result } }; assertCheckpointBudget(checkpoint);
    await this.store.saveTask({ ...receipt.task, checkpoint }, receipt.revision);
    return checkpointOf(await recoverPending(this.store, this.taskId)).result!;
  }
  async unresolved(input: unknown) {
    const args = toolSchemas.finish_unresolved.parse(input); const receipt = await this.enter();
    await this.store.saveTask({ ...receipt.task, status: 'unresolved', note: args.reason }, receipt.revision);
    return { status: 'unresolved', reason: args.reason };
  }
}
