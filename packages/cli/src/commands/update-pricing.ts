import { getAllProviders, getPricingAgeInDays, getProviderMeta } from "@inferwise/pricing-db";
import { Command } from "commander";

const STALE_THRESHOLD_DAYS = 7;

export function updatePricingCommand(): Command {
  return new Command("update-pricing")
    .description("Check and display the freshness of the bundled pricing database")
    .option("--check", "Exit with code 1 if any provider pricing is stale (>7 days)")
    .action(async (options: { check?: boolean }) => {
      const providers = getAllProviders();
      let anyStale = false;

      process.stdout.write("Inferwise Pricing Database Status\n\n");
      process.stdout.write(
        `${"Provider".padEnd(12)} ${"Last Verified".padEnd(14)} ${"Age".padEnd(8)} ${"Status".padEnd(10)} Source\n`,
      );
      process.stdout.write(`${"─".repeat(90)}\n`);

      for (const provider of providers) {
        const meta = getProviderMeta(provider);
        const age = getPricingAgeInDays(provider);
        const isStale = age > STALE_THRESHOLD_DAYS;
        if (isStale) anyStale = true;

        const status = isStale ? "STALE" : "OK";
        process.stdout.write(
          `${provider.padEnd(12)} ${meta.last_verified.padEnd(14)} ${`${age}d`.padEnd(8)} ${status.padEnd(10)} ${meta.source}\n`,
        );
      }

      process.stdout.write("\n");

      if (anyStale) {
        process.stdout.write(
          `Warning: Some providers have pricing data older than ${STALE_THRESHOLD_DAYS} days.\n`,
        );
        process.stdout.write(
          "Run the sync script to refresh:\n  pnpm --filter @inferwise/scripts sync-pricing\n\n",
        );
        process.stdout.write(
          "Source: https://github.com/inferwise/inferwise/tree/main/packages/pricing-db\n",
        );

        if (options.check) {
          process.exit(1);
        }
      } else {
        process.stdout.write("All provider pricing is up to date.\n");
      }
    });
}
