// Loads .env via `node --env-file=.env`, then runs jest with inherited env.
const { spawnSync } = require("child_process");
const { resolve } = require("path");

const cwd = resolve(__dirname, "..");
const r = spawnSync(
  "jest",
  ["--testTimeout=0", "contract/runners/integration.contract.spec.ts"],
  {
  cwd,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(r.status ?? 1);
