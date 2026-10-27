/** Native pre-request admission; SDK notifications arrive too late to gate calls. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-token-meter';
export const inject = ['tokenMeter'];
export function apply(ctx: Context) {
  const max = Number(process.env.NAMES_MAX_STEPS), contextWindow = Number(process.env.NAMES_CONTEXT_WINDOW), output = Number(process.env.NAMES_OUTPUT_TOKENS);
  if (!Number.isInteger(max) || max < 1 || !Number.isFinite(contextWindow) || !Number.isFinite(output)) throw Error('Invalid names session guard configuration');
  const counts = new WeakMap<object, number>();
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const count = counts.get(agent) ?? 0;
    if (count >= max) return { kind: 'reject' };
    // Meter is a provider-usage/heuristic estimate. Reserve headroom for the
    // next output and protocol framing rather than compacting old conversations.
    if (count > 0 && ctx.tokenMeter.measure(agent.session).totalTokens + output + 1024 >= contextWindow * 0.8) return { kind: 'reject' };
    const decision = await next();
    if (decision.kind === 'enter') counts.set(agent, count + 1);
    return decision;
  });
}
