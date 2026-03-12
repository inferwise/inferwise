import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";

const CONFIG_TEMPLATE = {
  defaultVolume: 1000,
  ignore: ["node_modules", "dist", "build", "test", "__tests__", "*.test.ts", "*.spec.ts"],
  budgets: {
    warn: 2000,
    block: 50000,
  },
};

const PRE_COMMIT_HOOK = `#!/bin/sh
# Inferwise cost check — blocks commits that exceed budget thresholds
# Installed by: inferwise init
# Config: inferwise.config.json

npx inferwise check .
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Inferwise cost diff — compares HEAD against main before push
# Installed by: inferwise init
# Config: inferwise.config.json (budgets.block threshold)

npx inferwise diff --format table 2>&1
`;

/** Check if a file exists. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Find the git root by walking up from startDir. */
async function findGitRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  while (true) {
    if (await fileExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Install a git hook, backing up any existing one. */
async function installHook(
  hooksDir: string,
  hookName: string,
  content: string,
): Promise<"created" | "exists" | "updated"> {
  const hookPath = path.join(hooksDir, hookName);

  if (await fileExists(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    if (existing.includes("inferwise")) return "exists";
    // Append to existing hook
    await writeFile(hookPath, `${existing}\n${content}`, { mode: 0o755 });
    return "updated";
  }

  await writeFile(hookPath, content, { mode: 0o755 });
  return "created";
}

/** Detect which hook manager is in use (husky, lefthook, etc.) */
async function detectHookManager(gitRoot: string): Promise<"husky" | "lefthook" | "git" | null> {
  if (await fileExists(path.join(gitRoot, ".husky"))) return "husky";
  if (await fileExists(path.join(gitRoot, "lefthook.yml"))) return "lefthook";
  if (await fileExists(path.join(gitRoot, ".lefthook.yml"))) return "lefthook";
  // Check for .git/hooks directory (plain git)
  if (await fileExists(path.join(gitRoot, ".git", "hooks"))) return "git";
  return null;
}

export function initCommand(): Command {
  return new Command("init")
    .description("Set up Inferwise cost checks in your project")
    .option("--no-hooks", "Skip git hook installation")
    .option("--no-config", "Skip config file creation")
    .option("--hook <type>", "Hook type: pre-commit or pre-push", "pre-commit")
    .action(async (options: { hooks: boolean; config: boolean; hook: string }) => {
      const validHooks = ["pre-commit", "pre-push"];
      if (!validHooks.includes(options.hook)) {
        process.stderr.write(
          chalk.red(
            `Error: Invalid hook type "${options.hook}". Must be: ${validHooks.join(", ")}\n`,
          ),
        );
        process.exit(1);
      }

      const cwd = process.cwd();
      const gitRoot = await findGitRoot(cwd);

      process.stdout.write(chalk.bold("Inferwise Setup\n\n"));

      // Step 1: Create inferwise.config.json
      if (options.config) {
        const configPath = path.join(cwd, "inferwise.config.json");
        if (await fileExists(configPath)) {
          process.stdout.write(chalk.dim("  inferwise.config.json already exists, skipping.\n"));
        } else {
          await writeFile(configPath, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`);
          process.stdout.write(chalk.green("  Created inferwise.config.json\n"));
          process.stdout.write(
            chalk.dim("  Edit budgets.warn and budgets.block to set your cost thresholds.\n"),
          );
        }
      }

      // Step 2: Install git hooks
      if (options.hooks && gitRoot) {
        const hookContent = options.hook === "pre-push" ? PRE_PUSH_HOOK : PRE_COMMIT_HOOK;
        const hookName = options.hook === "pre-push" ? "pre-push" : "pre-commit";
        const manager = await detectHookManager(gitRoot);

        if (manager === "husky") {
          // Install into .husky directory
          const huskyDir = path.join(gitRoot, ".husky");
          const result = await installHook(huskyDir, hookName, hookContent);
          if (result === "exists") {
            process.stdout.write(
              chalk.dim(`  .husky/${hookName} already has Inferwise, skipping.\n`),
            );
          } else {
            process.stdout.write(
              chalk.green(`  ${result === "created" ? "Created" : "Updated"} .husky/${hookName}\n`),
            );
          }
        } else if (manager === "lefthook") {
          process.stdout.write(chalk.yellow("  Lefthook detected. Add to your lefthook.yml:\n\n"));
          process.stdout.write(chalk.dim(`  ${hookName}:\n`));
          process.stdout.write(chalk.dim("    commands:\n"));
          process.stdout.write(chalk.dim("      inferwise:\n"));
          process.stdout.write(chalk.dim("        run: npx inferwise check .\n\n"));
        } else {
          // Plain git hooks
          const hooksDir = path.join(gitRoot, ".git", "hooks");
          await mkdir(hooksDir, { recursive: true });
          const result = await installHook(hooksDir, hookName, hookContent);
          if (result === "exists") {
            process.stdout.write(
              chalk.dim(`  .git/hooks/${hookName} already has Inferwise, skipping.\n`),
            );
          } else {
            process.stdout.write(
              chalk.green(
                `  ${result === "created" ? "Created" : "Updated"} .git/hooks/${hookName}\n`,
              ),
            );
          }
        }
      } else if (options.hooks && !gitRoot) {
        process.stdout.write(
          chalk.yellow("  Not a git repository — skipping hook installation.\n"),
        );
      }

      // Step 3: Print next steps
      process.stdout.write(chalk.bold("\nNext steps:\n"));
      process.stdout.write("  1. Edit inferwise.config.json to set your budget thresholds\n");
      process.stdout.write("  2. Run: inferwise estimate . to verify scanning works\n");
      process.stdout.write("  3. Commit inferwise.config.json to your repo\n");

      if (gitRoot) {
        process.stdout.write("\nCI setup (pick your platform):\n");
        process.stdout.write(chalk.dim("  GitHub Actions:\n"));
        process.stdout.write(chalk.dim("    - uses: inferwise/inferwise-action@v1\n"));
        process.stdout.write(
          chalk.dim("      with: { github-token: ${{ secrets.GITHUB_TOKEN }} }\n\n"),
        );
        process.stdout.write(chalk.dim("  GitLab CI:\n"));
        process.stdout.write(chalk.dim("    inferwise-check:\n"));
        process.stdout.write(chalk.dim("      script: npx inferwise diff --format table\n\n"));
        process.stdout.write(chalk.dim("  Any CI (generic):\n"));
        process.stdout.write(chalk.dim("    npx inferwise diff --base main --head HEAD\n"));
      }

      process.stdout.write(chalk.dim("\nDocs: https://inferwise.dev/docs/setup\n"));
    });
}
