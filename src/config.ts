import { z } from 'zod';
import { resolve } from 'node:path';
import {parseServiceRegistry} from './services.js';
export const NameInputSchema = z.strictObject({ name: z.string().trim().min(1).max(256).transform(s => s.normalize('NFC')), language: z.string().trim().min(1).max(128).optional() });
export type NameInput = z.infer<typeof NameInputSchema>;
const endpoint = z.url().refine(value => {
  const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
}, 'Use an HTTP(S) endpoint without credentials, query or fragment');
export const ConfigSchema = z.strictObject({
  userAgent: z.string().trim().min(1).max(512).refine(s => !/[\r\n]/.test(s)),
  store: z.strictObject({ baseUrl: endpoint.default('http://127.0.0.1:4318') }),
  model: z.strictObject({ baseUrl: endpoint.default('http://127.0.0.1:1234/v1'), id: z.string().min(1).max(256), contextWindow: z.number().int().min(8192).max(131072).default(16384), maxOutputTokens: z.number().int().min(256).max(8192).default(2048) }),
  dataDir: z.string().min(1).transform(s => resolve(s)).default(resolve('.data')),
  vaultFile: z.string().min(1).transform(s=>resolve(s)).default(resolve('.data/credentials.vault')),
  services: z.unknown().optional().transform(v=>parseServiceRegistry(v??{})),
  budgets: z.strictObject({ maxSessions: z.number().int().min(1).max(20).default(4), maxSessionSteps: z.number().int().min(1).max(12).default(6), maxTools: z.number().int().min(1).max(100).default(24), maxLookups: z.number().int().min(1).max(8).default(8), maxSessionMs: z.number().int().min(1000).max(600000).default(180000), maxNameMs: z.number().int().min(1000).max(1800000).default(600000) }).prefault({}),
}).refine(c => c.model.maxOutputTokens <= c.model.contextWindow / 4, 'Output cap must be at most one quarter of the context window');
export type Config = z.infer<typeof ConfigSchema>;
