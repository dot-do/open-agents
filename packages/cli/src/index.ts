#!/usr/bin/env node
import { Command } from "commander";
import { apiRequest, loadConfig, saveConfig } from "./client.js";

const program = new Command();

program
  .name("oa")
  .description("Open Agents CLI")
  .version("0.1.0");

// ── login ──────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Store a Personal Access Token")
  .requiredOption("--token <pat>", "Personal Access Token")
  .option("--api-url <url>", "API base URL")
  .action((opts: { token: string; apiUrl?: string }) => {
    const config = loadConfig();
    config.token = opts.token;
    if (opts.apiUrl) config.apiUrl = opts.apiUrl;
    saveConfig(config);
    console.log("Token saved to ~/.open-agents/config.json");
  });

// ── health ─────────────────────────────────────────────────────────────

program
  .command("health")
  .description("Check API health")
  .action(async () => {
    const data = await apiRequest("GET", "/api/health");
    console.log(JSON.stringify(data, null, 2));
  });

// ── tenant ─────────────────────────────────────────────────────────────

const tenant = program.command("tenant").description("Tenant management");

tenant
  .command("list")
  .description("List tenants")
  .action(async () => {
    const data = await apiRequest("GET", "/api/tenants");
    console.log(JSON.stringify(data, null, 2));
  });

tenant
  .command("switch <id>")
  .description("Switch active tenant")
  .action(async (id: string) => {
    const data = await apiRequest("POST", "/api/tenants/switch", {
      tenantId: id,
    });
    console.log(JSON.stringify(data, null, 2));
  });

// ── sessions ───────────────────────────────────────────────────────────

const sessions = program.command("sessions").description("Session management");

sessions
  .command("list")
  .description("List sessions")
  .action(async () => {
    const data = await apiRequest("GET", "/api/sessions");
    console.log(JSON.stringify(data, null, 2));
  });

sessions
  .command("create")
  .description("Create a new session")
  .option("--template <id>", "Session template ID")
  .option("--repo <owner/repo>", "GitHub repository (owner/repo)")
  .option("--title <title>", "Session title")
  .action(async (opts: { template?: string; repo?: string; title?: string }) => {
    const body: Record<string, unknown> = {};
    if (opts.template) body.templateId = opts.template;
    if (opts.title) body.title = opts.title;
    if (opts.repo) {
      const parts = opts.repo.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        console.error("Error: --repo must be in owner/repo format");
        process.exit(1);
      }
      body.repoOwner = parts[0];
      body.repoName = parts[1];
    }
    const data = await apiRequest("POST", "/api/sessions", body);
    console.log(JSON.stringify(data, null, 2));
  });

// ── templates ──────────────────────────────────────────────────────────

const templates = program
  .command("templates")
  .description("Session template management");

templates
  .command("list")
  .description("List session templates")
  .action(async () => {
    const data = await apiRequest("GET", "/api/tenant/templates");
    console.log(JSON.stringify(data, null, 2));
  });

// ── run ────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
