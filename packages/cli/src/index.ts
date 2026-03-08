#!/usr/bin/env node
import { Command } from "commander";
import { diffCommand } from "./commands/diff.js";
import { estimateCommand } from "./commands/estimate.js";
import { updatePricingCommand } from "./commands/update-pricing.js";

const program = new Command();

program.name("inferwise").description("Know your LLM costs before you commit.").version("0.0.1");

program.addCommand(estimateCommand());
program.addCommand(diffCommand());
program.addCommand(updatePricingCommand());

program.parse();
