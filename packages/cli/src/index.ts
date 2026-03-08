import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { diffCommand } from "./commands/diff.js";
import { estimateCommand } from "./commands/estimate.js";
import { priceCommand } from "./commands/price.js";
import { updatePricingCommand } from "./commands/update-pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as {
  version: string;
};

const program = new Command();

program
  .name("inferwise")
  .description("Know your LLM costs before you commit.")
  .version(pkg.version);

program.addCommand(estimateCommand());
program.addCommand(diffCommand());
program.addCommand(priceCommand());
program.addCommand(updatePricingCommand());

program.parse();
