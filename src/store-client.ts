import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ResearchTaskSchema, type ResearchTask, type ResearchTaskReceipt } from '@lambdawalker/names-research-store/contracts';
export class StorageError extends Error { constructor(public status: number, message: string) { super(message); } }
const Receipt = z.object({ task: ResearchTaskSchema, revision: z.number().int().positive(), updated_at: z.iso.datetime({ offset: true }) });
export class StorageClient {
  private readonly url: string;
  constructor(baseUrl: string, private token: string, private fetcher: typeof fetch = fetch) {
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('Invalid storage URL');
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw Error('Remote storage requires HTTPS');
    if (token.length < 32) throw Error('STORE_API_TOKEN must contain at least 32 characters');
    this.url = u.href.replace(/\/$/, '');
  }
  async call(name: string, input: unknown): Promise<unknown> {
    if (!/^[a-z_]+$/.test(name)) throw Error('Invalid operation');
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.fetcher(`${this.url}/v1/operations/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) { void response.body?.cancel(); throw new StorageError(response.status, `Storage operation ${name} failed (HTTP ${response.status})`); }
        const reader = response.body?.getReader(); if (!reader) throw Error('Empty storage response');
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 131072) throw Error('Storage response exceeds limit'); chunks.push(value); } }
        finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        if (error instanceof StorageError || attempt >= 2) throw error instanceof StorageError ? error : new Error(`Storage operation ${name} failed; check service availability`);
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
  async getTask(id: string): Promise<ResearchTaskReceipt | null> { return Receipt.nullable().parse(await this.call('get_research_task', { task_id: id })); }
  async saveTask(task: ResearchTask, revision: number, writeId: string = randomUUID()): Promise<ResearchTaskReceipt> {
    return Receipt.parse(await this.call('save_research_task', { task: JSON.parse(JSON.stringify(task)), expected_revision: revision, write_id: writeId }));
  }
}
