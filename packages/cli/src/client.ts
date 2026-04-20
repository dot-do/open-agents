import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".open-agents");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

type Config = {
  token?: string;
  apiUrl?: string;
};

export function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Config;
    }
  } catch {
    // ignore corrupt config
  }
  return {};
}

export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

function getToken(): string {
  const envToken = process.env["OA_TOKEN"];
  if (envToken) return envToken;
  const config = loadConfig();
  if (config.token) return config.token;
  throw new Error(
    "No token found. Run `oa login --token <pat>` or set OA_TOKEN env var.",
  );
}

function getBaseUrl(): string {
  const envUrl = process.env["OA_API_URL"];
  if (envUrl) return envUrl.replace(/\/$/, "");
  const config = loadConfig();
  if (config.apiUrl) return config.apiUrl.replace(/\/$/, "");
  return "https://open-agents.com";
}

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const token = getToken();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}
