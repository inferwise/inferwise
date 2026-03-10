import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { auditCommand } from "./commands/audit.js";
import { calibrateCommand } from "./commands/calibrate.js";
import { checkCommand } from "./commands/check.js";
import { diffCommand } from "./commands/diff.js";
import { estimateCommand } from "./commands/estimate.js";
import { initCommand } from "./commands/init.js";
import { priceCommand } from "./commands/price.js";
import { updatePricingCommand } from "./commands/update-pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as {
  version: string;
};

const program = new Command();

program
  .name("inferwise")
  .description("Know and control your LLM costs before they ship.")
  .version(pkg.version);

program.addCommand(initCommand());
program.addCommand(estimateCommand());
program.addCommand(diffCommand());
program.addCommand(auditCommand());
program.addCommand(priceCommand());
program.addCommand(checkCommand());
program.addCommand(calibrateCommand());
program.addCommand(updatePricingCommand());

program.parse();
