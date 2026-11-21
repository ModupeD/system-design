// ENTRY POINT: build the SAME application, but start the CLI driving adapter.
// Defaults to file storage so orders survive between commands.

import { runCli } from "./adapters/driving/cli/cli.ts";
import { buildApp } from "./composition/container.ts";

const app = buildApp({ ...process.env, STORAGE: process.env.STORAGE ?? "file" });
process.exitCode = await runCli(process.argv.slice(2), app);
