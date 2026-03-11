import type { Logger } from "../../interfaces/logger.js";
import type { PgPool } from "./client.js";

export interface PostgresStoreDeps {
    pool: PgPool;
    logger?: Logger;
}
