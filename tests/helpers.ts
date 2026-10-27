import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, createApi } from '@lambdawalker/names-research-store';
import { StorageClient } from '../src/store-client.js';
import { ConfigSchema } from '../src/config.js';
import { WiktionaryClient } from '@lambdawalker/names-api-wiktionary';
export async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'names-root-')); const store = new Store(dir);
  const token = 'synthetic-test-token-'.repeat(3); const api = createApi(store, token);
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const address = api.address(); if (!address || typeof address === 'string') throw Error('listen');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const storage = new StorageClient(baseUrl, token);
  const config = ConfigSchema.parse({ userAgent: 'NamesTest/1 (https://example.org/contact)', store: { baseUrl }, model: { id: 'test-model' }, dataDir: dir });
  const wiki = new WiktionaryClient({ userAgent: config.userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ parse: { title: 'John', pageid: 1, revid: 5, text: '<h2 id="English">English</h2><h3 id="Etymology">Etymology</h3><p>John derives from Hebrew יוֹחָנָן, meaning God is gracious.</p>' } })) });
  return { dir, store, storage, config, wiki, close: async () => { await new Promise<void>(resolve => api.close(() => resolve())); store.close(); await rm(dir, { recursive: true, force: true }); } };
}
export const proposal = (citation: string) => ({
  subject: { language: { code: 'en', name: 'English' }, script: 'Latn', kind: 'given_name' },
  root: { spelling: 'יוֹחָנָן', language: { code: 'he', name: 'Hebrew' }, script: 'Hebr', kind: 'given_name', reconstructed: false, transliterations: [] },
  citation_ids: [citation], meaning: 'God is gracious', meaning_language: 'en', interpretation: 'The source explicitly traces John to this Hebrew form.',
});
