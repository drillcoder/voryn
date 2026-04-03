export interface DbQueryResult<TRow = unknown> {
    rows: TRow[];
    rowCount: number | null;
}

export interface DbExecutor {
    query<TRow = unknown>(text: string, params?: readonly unknown[]): Promise<DbQueryResult<TRow>>;
}
