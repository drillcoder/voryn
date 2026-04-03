export type StreamType = "event" | "tx";

export type BlockJobStatus =
    | "pending"
    | "fetching"
    | "fetched"
    | "committed"
    | "failed";
