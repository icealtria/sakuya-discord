# Sakuya Discord Adapter

This is a Discord adapter extension for Sakuya, allowing the agent to
communicate with users through Discord.

## Installation & Build

Navigate to the extension directory and run:

```bash
bun install
bun run build
```

The build artifacts will be placed in the `dist` directory.

## Configuration

When this extension starts for the first time, it automatically generates a
`config.json` file in the extension's directory. You must provide a Discord Bot
Token for the adapter to function.

### `config.json` Options

| Key                 | Type       | Description                                             |
| :------------------ | :--------- | :------------------------------------------------------ |
| `token`             | `string`   | **Required**. Your Discord Bot Token.                   |
| `allowedGuildIds`   | `string[]` | Optional. List of server IDs the bot can interact with. |
| `allowedChannelIds` | `string[]` | Optional. List of channel IDs allowed for interaction.  |
| `allowedUserIds`    | `string[]` | Optional. List of user IDs allowed for interaction.     |
| `blockedUserIds`    | `string[]` | Optional. List of blocked user IDs to ignore.           |

### Example Configuration

```json
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "allowedGuildIds": ["123456789012345678"],
  "allowedChannelIds": [],
  "allowedUserIds": [],
  "blockedUserIds": []
}
```

## Deployment

1. Build the extension:
   ```bash
   bun run build
   ```
2. Create the extension directory in Sakuya's home:
   ```bash
   mkdir -p ~/.sakuya/extensions/discord
   ```
3. Copy the bundle to the extensions directory:
   ```bash
   cp dist/index.js ~/.sakuya/extensions/discord/
   ```
4. Enable the extension in `~/.sakuya/settings.json`:
   ```json
   {
     "extensions": ["discord"]
   }
   ```

## Quick Start (Summary)

1. Create a Bot in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Ensure **MESSAGE CONTENT INTENT** is enabled.
3. Obtain your Token and paste it into `~/.sakuya/extensions/discord/config.json`.
4. Restart Sakuya for the changes to take effect.

## License

MIT
