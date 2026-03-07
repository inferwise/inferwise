import { Command } from "commander";

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare token costs between two git refs")
    .option("--base <ref>", "Base git ref", "main")
    .option("--head <ref>", "Head git ref", "HEAD")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--fail-on-increase <amount>", "Exit 1 if monthly increase exceeds this USD amount")
    .action(async (options: Record<string, string>) => {
      // TODO: implement in Phase 1
      console.log("diff command — coming soon");
    });
}
