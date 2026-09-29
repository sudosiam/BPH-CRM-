declare module "@shared/sync-engine.mjs" {
  export function tombstoneFresh(deletedAt: string | null, now?: number): boolean;
  export function applyPull(db: unknown, payload: unknown, replaceAll: boolean): Promise<void>;
  export function flushOutbox(
    db: unknown,
    remote: unknown,
    onNotice: (message: string) => void,
    onConflict?: (local: any, server: any) => void,
  ): Promise<void>;
}
