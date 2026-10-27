import { expect, it } from 'vitest';
import { ResearchTools, recoverPending } from '../src/research-tools.js';
import { ensureTask, checkpointOf } from '../src/checkpoint.js';
import { fixture, proposal } from './helpers.js';

it('stores a cited candidate root with an explicit subject and resumes terminal tasks', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'John', language: 'English' });
    const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
    const doc = await tools.lookup({ title: 'John', language: 'English' });
    const section = doc.sections.find(s => s.title === 'Etymology')!;
    const fragment = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
    const result = await tools.submit(proposal(fragment.fragment_id));
    expect(result.status).toBe('review_required');
    const origin = f.store.readEntity('origins', result.origin_id).entity;
    expect(origin).toMatchObject({ status: 'candidate', subject_form_id: result.subject_form_id, root_form_id: result.root_form_id });
    expect(f.store.getResearchTask({ task_id: task.task.id })?.task.finding_ids).toHaveLength(1);
    const again = await ensureTask(f.storage, { name: 'John', language: 'English' });
    expect(again.task.status).toBe('review_required'); expect(f.store.status().findings).toBe(1);
  } finally { await f.close(); }
});
it('rejects forged cross-task citations, roots absent from passages and mismatched subject language', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'John', language: 'English' });
    const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
    await expect(tools.read({ document_id: 'a'.repeat(64), offset: 0, limit: 100 })).rejects.toThrow(/admitted/i);
    await expect(tools.submit(proposal('b'.repeat(64)))).rejects.toThrow(/citation/i);
    const doc = await tools.lookup({ title: 'John', language: 'English' });
    const section = doc.sections.find(s => s.title === 'Etymology')!;
    const frag = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
    const p = proposal(frag.fragment_id);
    await expect(tools.submit({ ...p, root: { ...p.root, spelling: 'INVENTED' } })).rejects.toThrow(/present/i);
    await expect(tools.submit({ ...p, subject: { ...p.subject, language: { code: 'es', name: 'Spanish' } } })).rejects.toThrow(/language/i);
    expect(f.store.status().findings).toBe(0);
  } finally { await f.close(); }
});
it('replays a pending finding after a crash without duplicate journal admission', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'John' });
    const original = f.storage.call.bind(f.storage); let fail = true;
    f.storage.call = async (name, input) => { if (name === 'record_finding' && fail) { fail = false; throw Error('crash'); } return original(name, input); };
    const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
    const doc = await tools.lookup({ title: 'John', language: 'English' });
    const section = doc.sections.find(s => s.title === 'Etymology')!;
    const frag = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
    await expect(tools.submit(proposal(frag.fragment_id))).rejects.toThrow('crash');
    const pending = await f.storage.getTask(task.task.id); expect(checkpointOf(pending!).pending).toBeTruthy();
    await recoverPending(f.storage, task.task.id); await recoverPending(f.storage, task.task.id);
    expect(f.store.status().findings).toBe(1); expect((await f.storage.getTask(task.task.id))?.task.status).toBe('review_required');
  } finally { await f.close(); }
});
it('reuses complete canonical forms even when existing IDs and transliterations differ', async () => {
  const f = await fixture(); try {
    const old = { ...proposal('x').root, id: 'legacy-root', transliterations: [{ text: 'Yohanan', system: 'legacy' }] };
    f.store.recordFinding({ idempotency_key: 'legacy', forms: [old] });
    const task = await ensureTask(f.storage, { name: 'John' }); const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
    const doc = await tools.lookup({ title: 'John', language: 'English' }); const section = doc.sections.find(s => s.title === 'Etymology')!;
    const frag = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
    expect((await tools.submit(proposal(frag.fragment_id))).root_form_id).toBe('legacy-root');
  } finally { await f.close(); }
});
it('charges failed source attempts durably and refuses a second fetch beyond quota', async () => {
  const f = await fixture(); let attempts = 0; try {
    const task = await ensureTask(f.storage, { name: 'Missing' });
    const wiki = { getPage: async () => { attempts++; throw Error('missing'); } };
    const config = { ...f.config, budgets: { ...f.config.budgets, maxLookups: 1 } };
    await expect(new ResearchTools(f.storage, wiki, task.task.id, config).lookup({ title: 'Missing' })).rejects.toThrow();
    await expect(new ResearchTools(f.storage, wiki, task.task.id, config).lookup({ title: 'Missing' })).rejects.toThrow(/budget/i);
    expect(attempts).toBe(1);
  } finally { await f.close(); }
});
it('keeps repeated fragments compact and reserves space to submit after many reads', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'John' });
    const original = await f.wiki.getPage('John', { language: 'English' });
    const wiki = { getPage: async () => ({ ...original, locator: 'https://en.wiktionary.org/w/index.php?title=' + encodeURIComponent('漢'.repeat(200)) + '&oldid=5' }) };
    const config = { ...f.config, budgets: { ...f.config.budgets, maxTools: 100 } };
    const tools = new ResearchTools(f.storage, wiki, task.task.id, config);
    const doc = await tools.lookup({ title: '漢'.repeat(200), language: 'English' });
    const section = doc.sections.find(s => s.title === 'Etymology')!;
    let citation = '';
    for (let i = 0; i < 16; i++) citation = (await tools.read({ document_id: doc.document_id, offset: section.start + i, limit: 1000 })).fragment_id;
    expect((await tools.submit(proposal(citation))).status).toBe('review_required');
  } finally { await f.close(); }
});
it('replays after the finding was committed but the completion checkpoint failed', async () => {
  const f = await fixture(); try {
    const task = await ensureTask(f.storage, { name: 'John' }); const tools = new ResearchTools(f.storage, f.wiki, task.task.id, f.config);
    const doc = await tools.lookup({ title: 'John', language: 'English' }); const section = doc.sections.find(s => s.title === 'Etymology')!;
    const frag = await tools.read({ document_id: doc.document_id, offset: section.start, limit: 1000 });
    const save = f.storage.saveTask.bind(f.storage); let fail = true;
    f.storage.saveTask = async (task, rev, write) => { if (task.status === 'review_required' && fail) { fail = false; throw Error('lost completion'); } return save(task, rev, write); };
    await expect(tools.submit(proposal(frag.fragment_id))).rejects.toThrow('lost completion'); expect(f.store.status().findings).toBe(1);
    await recoverPending(f.storage, task.task.id); expect(f.store.status().findings).toBe(1);
    expect((await f.storage.getTask(task.task.id))?.task.status).toBe('review_required');
  } finally { await f.close(); }
});
