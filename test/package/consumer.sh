#!/bin/sh

set -eu

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

archive_dir="$tmp_dir/archive"
consumer_dir="$tmp_dir/consumer"
mkdir -p "$archive_dir" "$consumer_dir"

typescript_bin="$(pwd)/node_modules/.bin/tsc"

archive_name="$(npm pack --pack-destination "$archive_dir" --silent)"
archive_path="$archive_dir/$archive_name"

npm install --prefix "$consumer_dir" --ignore-scripts --no-audit --no-fund "$archive_path"
cp test/package/consumer.ts "$consumer_dir/consumer.mts"

"$typescript_bin" \
    --noEmit \
    --ignoreConfig \
    --strict \
    --target ES2022 \
    --module NodeNext \
    --moduleResolution NodeNext \
    "$consumer_dir/consumer.mts"

cd "$consumer_dir"
node --input-type=module -e '
    import { readFile } from "node:fs/promises";
    import { HeadWorker } from "@drillcoder/voryn";

    if (typeof HeadWorker !== "function") {
        throw new Error("The package root does not expose HeadWorker");
    }

    const schemaUrl = import.meta.resolve("@drillcoder/voryn/sql/postgres-schema.sql");
    const schema = await readFile(new URL(schemaUrl), "utf8");

    if (!schema.includes("CREATE TABLE")) {
        throw new Error("The exported PostgreSQL schema is missing or invalid");
    }
'
