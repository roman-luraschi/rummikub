import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dir = join("src", "engine", "tests");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => join(dir, name));

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-timeout=30000", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
