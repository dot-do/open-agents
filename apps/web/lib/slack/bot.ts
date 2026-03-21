import { Chat } from "chat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { getRedisUrl } from "@/lib/redis";
import { handleSlackMention } from "./session-kickoff";

let slackBot: Chat<{ slack: SlackAdapter }> | null = null;

export function isSlackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_BOT_TOKEN &&
    process.env.SLACK_SIGNING_SECRET &&
    getRedisUrl(),
  );
}

export function getSlackBot(): Chat<{ slack: SlackAdapter }> {
  if (!isSlackConfigured()) {
    throw new Error(
      "Slack integration requires SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and REDIS_URL/KV_URL",
    );
  }

  if (slackBot) {
    return slackBot;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    throw new Error("Slack integration requires REDIS_URL or KV_URL");
  }

  const slack = createSlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

  const bot = new Chat({
    userName: process.env.SLACK_BOT_USERNAME ?? "openharness",
    adapters: { slack },
    state: createRedisState({
      url: redisUrl,
      keyPrefix: "openharness-slack",
    }),
  }).registerSingleton();

  bot.onNewMention(handleSlackMention);

  slackBot = bot;
  return bot;
}

export function getSlackAdapter(): SlackAdapter {
  return getSlackBot().getAdapter("slack");
}
