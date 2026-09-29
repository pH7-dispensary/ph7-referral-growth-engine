import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

export function loadReferralDatabaseEnvironment(): NodeJS.ProcessEnv {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.REFERRAL_DATABASE_URL;
  if (!connectionString) throw new Error("REFERRAL_DATABASE_URL is unavailable.");

  const parsed = new URL(connectionString);
  if (!parsed.hostname || !parsed.pathname || !parsed.username) {
    throw new Error("REFERRAL_DATABASE_URL is not a valid PostgreSQL connection URL.");
  }

  // Pass individual libpq variables to psql so the complete URL is never part of
  // command arguments, child output, or an inherited environment variable.
  const environment = { ...process.env };
  delete environment.REFERRAL_DATABASE_URL;
  environment.PGHOST = parsed.hostname;
  environment.PGPORT = parsed.port || "5432";
  environment.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  environment.PGUSER = decodeURIComponent(parsed.username);
  environment.PGPASSWORD = decodeURIComponent(parsed.password);
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode) environment.PGSSLMODE = sslmode;
  return environment;
}

export async function runPsql(arguments_: readonly string[]): Promise<string> {
  const environment = loadReferralDatabaseEnvironment();
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["--no-psqlrc", "-X", ...arguments_], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", () => reject(new Error("The PostgreSQL client could not be started.")));
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      // Connection diagnostics may include a host, role, or other deployment
      // metadata. Classify them without copying sensitive detail into logs.
      const diagnostic = classifyPsqlFailure(stderr);
      reject(new Error(`PostgreSQL command failed (exit ${code ?? "unknown"}): ${diagnostic}.`));
    });
  });
}

function classifyPsqlFailure(stderr: string): string {
  if (/could not translate host name/i.test(stderr)) return "database host could not be resolved";
  if (/password authentication failed|authentication failed/i.test(stderr)) return "database authentication was rejected";
  if (/no pg_hba\.conf entry|connection timed out|connection refused/i.test(stderr)) return "database network access was rejected";
  if (/SSL|TLS/i.test(stderr)) return "database TLS negotiation failed";
  if (/must be owner|permission denied|not permitted/i.test(stderr)) return "database role lacks required schema permission";
  if (/cannot be disabled|cannot alter|cannot run inside a transaction/i.test(stderr)) return "database rejected the requested transactional schema operation";
  const serverError = stderr.match(/^ERROR:\s+(.+)$/im)?.[1];
  if (serverError) return serverError
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]")
    .replace(/\b(host|user|password|passfile)=\S+/gi, "$1=[REDACTED]");
  return "database command diagnostic redacted";
}
