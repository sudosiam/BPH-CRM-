export function tombstoneFresh(deletedAt: string | null, now?: number): boolean;

export function applyPull(
  db: {
    transaction: (...args: unknown[]) => Promise<unknown>;
    leads: DbTable;
    profiles: DbTable;
    meta: DbTable;
    outbox: DbTable;
  },
  payload: {
    leads: Array<Record<string, unknown>>;
    profiles: Array<Record<string, unknown>>;
    expiredIds?: string[];
    org: unknown;
    serverTime: string;
  },
  replaceAll: boolean,
): Promise<void>;

export function flushOutbox(
  db: {
    meta: DbTable;
    outbox: DbTable;
    leads: DbTable;
    profiles: DbTable;
  },
  remote: {
    pushLead: (lead: Record<string, unknown>, baseVersion: number | null) => Promise<{
      ok: boolean;
      lead: Record<string, unknown> | null;
      deleted?: boolean;
    }>;
  },
  onNotice: (message: string) => void,
  onConflict?: (local: Record<string, unknown>, server: Record<string, unknown>) => void,
): Promise<void>;

interface DbTable {
  toArray?: () => Promise<Array<Record<string, unknown> & { id: string }>>;
  get: (id: string) => Promise<(Record<string, unknown> & { id: string }) | undefined>;
  put: (row: Record<string, unknown> & { id: string }) => Promise<void>;
  delete?: (id: string) => Promise<void>;
  clear?: () => Promise<void>;
  bulkPut?: (rows: Array<Record<string, unknown> & { id: string }>) => Promise<void>;
}
