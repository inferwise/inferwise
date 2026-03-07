import { Command } from "commander";
import { getAllProviders, getProviderMeta, getPricingAgeInDays } from "@inferwise/pricing-db";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const STALE_THRESHOLD_DAYS = 7;

export function updatePricingCommand(): Command {
  return new Command("update-pricing")
    .description("Check and display the freshness of the bundled pricing database")
    .option("--check", "Exit with code 1 if any provider pricing is stale (>7 days)")
    .action(async (options: { check?: boolean }) => {
      const providers = getAllProviders();
      let anyStale = false;

      console.log("Inferwise Pricing Database Status\n");
      console.log(
        `${"Provider".padEnd(12)} ${"Last Verified".padEnd(14)} ${"Age".padEnd(8)} ${"Status".padEnd(10)} Source`,
      );
      console.log("─".repeat(90));

      for (const provider of providers) {
        const meta = getProviderMeta(provider);
        const age = getPricingAgeInDays(provider);
        const isStale = age > STALE_THRESHOLD_DAYS;
        if (isStale) anyStale = true;

        const status = isStale ? "STALE" : "OK";
        console.log(
          `${provider.padEnd(12)} ${meta.last_verified.padEnd(14)} ${`${age}d`.padEnd(8)} ${status.padEnd(10)} ${meta.source}`,
        );
      }

      console.log();

      if (anyStale) {
        console.log(
          `Warning: Some providers have pricing data older than ${STALE_THRESHOLD_DAYS} days.`,
        );
        console.log(
          "Run the sync script to refresh:\n  pnpm --filter @inferwise/scripts sync-pricing\n",
        );
        console.log(`Source: ${LITELLM_URL}`);

        if (options.check) {
          process.exit(1);
        }
      } else {
        console.log("All provider pricing is up to date.");
      }
    });
}
