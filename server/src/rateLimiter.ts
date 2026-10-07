import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { create: 10, join: 30 } as const;

export class RateLimiter extends DurableObject<Env> {
  async allow(bucket: keyof typeof LIMITS): Promise<boolean> {
    const now = Date.now();
    const stamps = (await this.ctx.storage.get<number[]>(bucket)) ?? [];
    const recent = stamps.filter((stamp) => now - stamp < WINDOW_MS);
    if (recent.length >= LIMITS[bucket]) {
      await this.ctx.storage.put(bucket, recent);
      return false;
    }
    recent.push(now);
    await this.ctx.storage.put(bucket, recent);
    return true;
  }
}
