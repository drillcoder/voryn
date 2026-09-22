import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { generateNotes } from "@semantic-release/release-notes-generator";

const config = JSON.parse(readFileSync(new URL("../../.releaserc.json", import.meta.url), "utf8"));
const plugin = config.plugins.find(([name]) => name === "@semantic-release/release-notes-generator");

assert.ok(plugin, "release-notes generator must be configured");

const notes = await generateNotes(plugin[1], {
    commits: [
        {
            hash: "cd44dd46533f9f5db716354a2c5bf47de7a43783",
            message: "feat: move confirmations to reaction workers and handle reorgs",
        },
        {
            hash: "2c1c53181de2fa9f83728d64a4d5c6edb82db6e1",
            message: "feat: integrate RPC endpoint pooling",
        },
    ],
    lastRelease: { gitTag: "v1.0.3" },
    nextRelease: { version: "1.1.0", gitTag: "v1.1.0" },
    options: { repositoryUrl: "https://github.com/drillcoder/voryn.git" },
    cwd: process.cwd(),
});

assert.match(notes, /### Features/);
assert.match(notes, /integrate RPC endpoint pooling/);
assert.match(notes, /move confirmations to reaction workers and handle reorgs/);

process.stdout.write("Release notes include feature commits.\n");
