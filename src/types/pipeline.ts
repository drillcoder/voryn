export type StreamType = "event" | "transaction";

export type BlockJobStatus =
    | "pending"
    | "fetching"
    | "fetched"
    | "committed"
    | "failed";
