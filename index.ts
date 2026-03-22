import {
  Attachment,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type SendableChannels,
} from "discord.js";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import {
  type SakuyaExtension,
  type Adapter,
  type AdapterMessageHandler,
  type InboundMessage,
  type ExtensionContext,
  type AttachmentRef
} from "sakuya-types";

export interface DiscordConfig {
  token: string;
  allowedGuildIds?: string[];
  allowedChannelIds?: string[];
  allowedUserIds?: string[];
  blockedUserIds?: string[];
}

export class DiscordAdapter implements Adapter {
  readonly name = "discord";

  private client: Client | null = null;

  constructor(
    private readonly token: string,
    private readonly handler: AdapterMessageHandler,
    private readonly config: DiscordConfig,
  ) { }

  canHandleChannel(channelKey: string): boolean {
    return channelKey.startsWith("dc:");
  }

  canHandleFile(fileId: string): boolean {
    return fileId.startsWith("http://") || fileId.startsWith("https://");
  }

  async start(): Promise<void> {
    if (this.client) return;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
    });

    client.on(Events.ClientReady, (readyClient) => {
      console.log(`[discord-extension] connected as ${readyClient.user.tag}`);
    });

    client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((error) => {
        console.error("[discord-extension] message handling failed", error);
      });
    });

    this.client = client;
    await client.login(this.token);
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await this.client.destroy();
    this.client = null;
  }

  async sendMessage(channelKey: string, text: string, replyToMessageId?: string): Promise<string> {
    const channel = await this.resolveTextChannel(channelKey);
    const message = await channel.send(replyToMessageId
      ? {
        content: text,
        reply: {
          messageReference: replyToMessageId,
          failIfNotExists: false,
        },
      }
      : { content: text });
    return message.id;
  }

  async sendFile(channelKey: string, filePath: string, caption?: string): Promise<string> {
    const channel = await this.resolveTextChannel(channelKey);
    const message = await channel.send({
      content: caption,
      files: [filePath],
    });
    return message.id;
  }

  async setReaction(channelKey: string, messageId: string, emoji: string): Promise<string> {
    const channel = await this.resolveTextChannel(channelKey);
    const message = await channel.messages.fetch(messageId);
    const reaction = await message.react(emoji);
    return reaction.emoji.identifier;
  }

  async fetchImageContent(_channelKey: string, path: string): Promise<{ data: string; mimeType: string }> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to download Discord image: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    return { data: bytes.toString("base64"), mimeType };
  }

  private async handleMessage(message: Message): Promise<void> {
    const clientUser = this.requireClient().user;
    if (!clientUser || message.author.bot) return;

    // Filter by guild/channel/user if configured
    if (this.config.allowedGuildIds?.length && !this.config.allowedGuildIds.includes(message.guildId || "")) return;
    if (this.config.allowedChannelIds?.length && !this.config.allowedChannelIds.includes(message.channelId)) return;
    if (this.config.allowedUserIds?.length && !this.config.allowedUserIds.includes(message.author.id)) return;
    if (this.config.blockedUserIds?.includes(message.author.id)) return;

    const trigger = this.resolveTrigger(message, clientUser.id);
    const channelKey = toChannelKey(message);

    let command: { name: string; args: string } | undefined;
    const cmdMatch = message.content.match(/^\/([a-z0-9_]+)(?:\s+([\s\S]*))?$/i);
    if (cmdMatch) {
      command = { name: cmdMatch[1].toLowerCase(), args: (cmdMatch[2] ?? "").trim() };
    }

    const inbound: InboundMessage = {
      id: message.id,
      source: "discord",
      channelKey,
      sender: {
        id: message.author.id,
        username: message.author.username,
        name: message.author.globalName || message.author.displayName,
        isBot: message.author.bot,
      },
      text: message.content,
      command,
      attachments: this.extractAttachments(message.attachments.values()),
      replyToMessageId: message.reference?.messageId || undefined,
      raw: {
        guildId: message.guildId,
        channelId: message.channelId,
      },
      receivedAt: message.createdAt.toISOString(),
      trigger,
    };

    await this.handler.onInbound(inbound);
  }

  private resolveTrigger(message: Message, botId: string): InboundMessage["trigger"] {
    if (!message.guildId) return "direct";
    if (message.mentions.repliedUser?.id === botId) return "reply";
    if (message.mentions.has(botId)) return "mention";
    return "passive";
  }

  private extractAttachments(attachments: IterableIterator<Attachment>): AttachmentRef[] {
    const out: AttachmentRef[] = [];
    for (const attachment of attachments) {
      const mimeType = attachment.contentType || undefined;
      const type = mimeType?.startsWith("image/") ? "image" : "document";
      out.push({
        type,
        path: attachment.url,
        mimeType,
        size: attachment.size,
        fileName: attachment.name || undefined,
      });
    }
    return out;
  }

  private async resolveTextChannel(channelKey: string): Promise<SendableChannels> {
    const client = this.requireClient();
    const target = parseChannelKey(channelKey);

    if (target.kind === "dm") {
      const user = await client.users.fetch(target.userId);
      const dm = await user.createDM();
      if (!dm.isSendable()) {
        throw new Error(`Discord DM channel is not sendable: ${channelKey}`);
      }
      return dm;
    }

    const channel = await client.channels.fetch(target.channelId);
    if (!channel?.isSendable()) {
      throw new Error(`Discord channel is not text-based: ${channelKey}`);
    }
    if (channel.type === ChannelType.GuildStageVoice || channel.type === ChannelType.GuildVoice) {
      throw new Error(`Discord voice channel is not sendable: ${channelKey}`);
    }
    return channel;
  }

  private requireClient(): Client {
    if (!this.client) throw new Error("Discord bot is disconnected.");
    return this.client;
  }
}

function toChannelKey(message: Message): string {
  if (!message.guildId) {
    return `dc:dm:${message.author.id}`;
  }
  return `dc:guild:${message.guildId}:${message.channelId}`;
}

function parseChannelKey(channelKey: string):
  | { kind: "dm"; userId: string }
  | { kind: "guild"; guildId: string; channelId: string } {
  const parts = channelKey.split(":");
  if (parts.length === 3 && parts[0] === "dc" && parts[1] === "dm") {
    return { kind: "dm", userId: parts[2] };
  }
  if (parts.length === 4 && parts[0] === "dc" && parts[1] === "guild") {
    return { kind: "guild", guildId: parts[2], channelId: parts[3] };
  }
  throw new Error(`Invalid Discord channel key: ${channelKey}`);
}

// Extension entry point
const extension: SakuyaExtension = {
  name: "discord-adapter",
  activate(ctx: ExtensionContext) {
    const configPath = join(ctx.extensionDir, "config.json");
    let config: DiscordConfig = {
      token: "",
      allowedGuildIds: [],
      allowedChannelIds: [],
      allowedUserIds: [],
      blockedUserIds: []
    };

    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch (e) {
        console.error(`[discord-extension] Failed to load config.json: ${e}`);
      }
    } else {
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`[discord-extension] Created default config.json at ${configPath}`);
    }

    if (!config.token) {
      console.warn("[discord-extension] No token found in config.json, adapter will not start.");
      return;
    }

    ctx.registerAdapter((handler) => new DiscordAdapter(config.token, handler, config));
  }
};

export default extension;
