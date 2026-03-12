import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { auditCommand } from "./commands/audit.js";
import { calibrateCommand } from "./commands/calibrate.js";
import { checkCommand } from "./commands/check.js";
import { diffCommand } from "./commands/diff.js";
import { estimateCommand } from "./commands/estimate.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { priceCommand } from "./commands/price.js";
import { updatePricingCommand } from "./commands/update-pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as {
  version: string;
};

function formatErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;

  // Git errors
  if (msg.includes("not a git repository")) {
    return "Not a git repository. Run this command from inside a git project.";
  }
  if (msg.includes("bad revision") || msg.includes("unknown revision")) {
    const ref = msg.match(/['"]([^'"]+)['"]/)?.[1] ?? "";
    return `Git ref '${ref}' not found. Run 'git branch -a' to see available refs.`;
  }

  // File system errors
  if ("code" in err && err.code === "ENOENT") {
    const filePath = "path" in err ? String(err.path) : "";
    return `File not found: ${filePath}`;
  }
  if ("code" in err && err.code === "EACCES") {
    const filePath = "path" in err ? String(err.path) : "";
    return `Permission denied: ${filePath}`;
  }

  // Config parse errors
  if (msg.includes("JSON")) {
    return `Invalid config file: ${msg}`;
  }

  return msg;
}

const program = new Command();

program.name("inferwise").description("Cost gates for LLM API calls.").version(pkg.version);

program.addCommand(initCommand());
program.addCommand(estimateCommand());
program.addCommand(diffCommand());
program.addCommand(auditCommand());
program.addCommand(priceCommand());
program.addCommand(checkCommand());
program.addCommand(calibrateCommand());
program.addCommand(fixCommand());
program.addCommand(updatePricingCommand());

async function main(): Promise<void> {
  try {
    await program.parseAsync();
  } catch (err: unknown) {
    process.stderr.write(chalk.red(`Error: ${formatErrorMessage(err)}\n`));
    process.exit(1);
  }
}

main();

process.on("unhandledRejection", (err: unknown) => {
  process.stderr.write(chalk.red(`Error: ${formatErrorMessage(err)}\n`));
  process.exit(1);
});
