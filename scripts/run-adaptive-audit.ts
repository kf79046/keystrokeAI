import { runAdaptiveAudit } from "../src/lib/quality/adaptiveAudit";

async function main() {
  const strict = process.argv.includes("--strict");
  const report = await runAdaptiveAudit();

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (strict && report.summary.totalViolations > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
