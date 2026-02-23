/**
 * In-memory database state for testing Supabase Edge Functions.
 *
 * Provides a lightweight mock of Supabase's PostgREST-backed database
 * with support for CRUD operations, filtering, ordering, pagination,
 * and RPC function simulation.
 *
 * @example
 * ```typescript
 * const db = new MockDBState({
 *   users: [{ id: "u1", name: "Alice" }],
 * });
 * db.insert("posts", { title: "Hello", user_id: "u1" });
 * const { data } = db.select("posts", { user_id: "u1" });
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/** Options for select queries */
export interface SelectOptions {
  /** Return row count in result */
  count?: boolean;
  /** Return only count, no data (HEAD semantics) */
  head?: boolean;
  /** Return single object instead of array */
  single?: boolean;
  /** Order by field, e.g. "created_at.desc" */
  order?: string;
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
}

/** Result shape matching Supabase client conventions */
export interface SelectResult {
  data: unknown[] | unknown | null;
  count: number | null;
  error: null;
}

/** Result shape for RPC calls */
export type RpcResult =
  | { data: unknown; error: null }
  | { data: null; error: { message: string } };

// =============================================================================
// MockDBState
// =============================================================================

/**
 * In-memory database that emulates Supabase/PostgREST behavior.
 *
 * Supports:
 * - Insert with auto-generated `id` and `created_at`
 * - Select with equality/ilike filters, ordering, limit/offset, single/count/head
 * - Update with `updated_at` tracking
 * - Upsert with configurable conflict key
 * - Delete with filter matching
 * - RPC function registration and execution
 */
export class MockDBState {
  private tables: Map<string, unknown[]> = new Map();
  private rpcHandlers: Map<string, (args: unknown) => unknown> = new Map();

  constructor(seed?: Record<string, unknown[]>) {
    if (seed) {
      for (const [table, rows] of Object.entries(seed)) {
        this.tables.set(table, [...rows]);
      }
    }
  }

  /** Get all rows from a table */
  getTable(name: string): unknown[] {
    return this.tables.get(name) ?? [];
  }

  /** Set table data directly (for seeding) */
  setTable(name: string, rows: unknown[]): void {
    this.tables.set(name, rows);
  }

  /** Insert rows into a table, returns inserted rows with generated ids */
  insert(table: string, rows: unknown | unknown[]): unknown[] {
    const existing = this.tables.get(table) ?? [];
    const newRows = Array.isArray(rows) ? rows : [rows];
    const inserted = newRows.map((row, i) => ({
      id: (row as Record<string, unknown>).id ??
        `${table}-${existing.length + i + 1}`,
      created_at: new Date().toISOString(),
      ...(row as Record<string, unknown>),
    }));
    this.tables.set(table, [...existing, ...inserted]);
    return inserted;
  }

  /** Select rows matching filters */
  select(
    table: string,
    filters?: Record<string, unknown>,
    options?: SelectOptions,
  ): SelectResult {
    let rows = this.getTable(table);

    if (filters) {
      rows = rows.filter((row) => {
        const r = row as Record<string, unknown>;
        return Object.entries(filters).every(([key, value]) => {
          const rowVal = r[key];
          // Case-insensitive string comparison (supports both eq and ilike)
          if (typeof rowVal === "string" && typeof value === "string") {
            return rowVal.toLowerCase() === value.toLowerCase();
          }
          return rowVal === value;
        });
      });
    }

    if (options?.order) {
      const [field, dir] = options.order.split(".");
      rows = [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        if (av === bv) return 0;
        const cmp = av! > bv! ? 1 : -1;
        return dir === "desc" ? -cmp : cmp;
      });
    }

    const totalCount = rows.length;

    if (options?.offset) {
      rows = rows.slice(options.offset);
    }
    if (options?.limit) {
      rows = rows.slice(0, options.limit);
    }

    if (options?.head) {
      return { data: null, count: totalCount, error: null };
    }

    if (options?.single) {
      return { data: rows[0] ?? null, count: totalCount, error: null };
    }

    return {
      data: rows,
      count: options?.count ? totalCount : null,
      error: null,
    };
  }

  /** Update rows matching filters, returns updated rows */
  update(
    table: string,
    filters: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): unknown[] {
    const rows = this.getTable(table);
    const updated: unknown[] = [];

    const newRows = rows.map((row) => {
      const r = row as Record<string, unknown>;
      const matches = Object.entries(filters).every(([key, value]) =>
        r[key] === value
      );
      if (matches) {
        const updatedRow = {
          ...r,
          ...updates,
          updated_at: new Date().toISOString(),
        };
        updated.push(updatedRow);
        return updatedRow;
      }
      return row;
    });

    this.tables.set(table, newRows);
    return updated;
  }

  /** Upsert rows (insert or update by conflict key) */
  upsert(
    table: string,
    rows: unknown | unknown[],
    conflictKey: string = "id",
  ): unknown[] {
    const newRows = Array.isArray(rows) ? rows : [rows];
    const result: unknown[] = [];

    for (const row of newRows) {
      const r = row as Record<string, unknown>;
      const existing = this.getTable(table);
      const existingIndex = existing.findIndex(
        (e) => (e as Record<string, unknown>)[conflictKey] === r[conflictKey],
      );

      if (existingIndex >= 0) {
        const updated = {
          ...(existing[existingIndex] as Record<string, unknown>),
          ...r,
          updated_at: new Date().toISOString(),
        };
        existing[existingIndex] = updated;
        result.push(updated);
      } else {
        const inserted = {
          id: r.id ?? `${table}-${existing.length + 1}`,
          created_at: new Date().toISOString(),
          ...r,
        };
        existing.push(inserted);
        result.push(inserted);
      }
      this.tables.set(table, existing);
    }

    return result;
  }

  /** Delete rows matching filters, returns count of deleted rows */
  delete(table: string, filters: Record<string, unknown>): number {
    const rows = this.getTable(table);
    const remaining = rows.filter((row) => {
      const r = row as Record<string, unknown>;
      return !Object.entries(filters).every(([key, value]) => r[key] === value);
    });
    const deleted = rows.length - remaining.length;
    this.tables.set(table, remaining);
    return deleted;
  }

  /** Register an RPC handler function */
  registerRpc(name: string, handler: (args: unknown) => unknown): void {
    this.rpcHandlers.set(name, handler);
  }

  /** Execute an RPC function */
  executeRpc(name: string, args: unknown): RpcResult {
    const handler = this.rpcHandlers.get(name);
    if (!handler) {
      return {
        data: null,
        error: { message: `RPC function '${name}' not found` },
      };
    }
    return { data: handler(args), error: null };
  }

  /** Reset all tables and RPC handlers */
  reset(): void {
    this.tables.clear();
    this.rpcHandlers.clear();
  }
}
