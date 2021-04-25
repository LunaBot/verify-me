import { Message, MessageEmbed } from "discord.js";
import { colours } from "../utils";
import { store } from "../store";

export const onMessage = async function onMessage (message: Message) {
    // Don't process bot messages
    if (message.author.bot) return;

    // Get command and arguments
    const [command, ...args] = message.content.slice(1).trim().split(/ +/);

    // Process DM
    if (!message.guild) return;

    // Bail if the message is missing out prefix
    if (!message.content.startsWith('!')) return;

    // Process guild message
    if (message.guild) {
        // If they're the owner let them set the admin role
        // !verify-settings set-admin 828108533953986582
        if (message.guild.owner?.id === message.author.id) {
            if (command === 'set-admin-role') {
                // Make sure we have the role we're asking for
                const role = message.guild.roles.cache.find(role => role.id === args[0]);
                if (!role) {
                    await message.channel.send(new MessageEmbed({
                        description: `No role found for \`${args[0]}\`!`
                    }));
                    return;
                }

                // Set the admin role
                store.guilds.set(message.guild.id, role.id, 'adminRole');
                await message.channel.send(new MessageEmbed({
                    description: `Admin role updated to \`${role.name}\`!`
                }));
                return;
            }

            // Allow guild to be reset
            if (command === 'clear-watched-messages') {
                const verificationMessageId = store.guilds.get(message.guild.id as string, 'verificationMessage');

                // Clear all watched messages for this guild
                [...store.watchedMessages.entries()].forEach(([messageId, guildId]) => {
                    // Ensure we clear all in this guild but
                    // don't clear the verification message watcher as we need that
                    if (guildId === message.guild?.id && message.id !== verificationMessageId) {
                        store.watchedMessages.delete(messageId);
                    }
                });

                return;
            }

            // Allow ticket number to be reset
            if (command === 'reset-counter') {
                // Reset ticket number
                store.guilds.set(message.guild.id, 0, 'ticketNumber');
                return;
            }

            // Dump the whole config for them
            if (command === 'show-config') {
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: '```\n' + JSON.stringify(store.guilds.get(message.guild.id), null, 2) +  '\n```'
                }));
                return;
            }
        }

        // If they're an admin let them change settings
        if (message.member?.roles.cache.find(role => role.id === store.guilds.get(message.guild!.id as string, 'adminRole'))) {
            // Set the watched message
            if (command === 'set-watched-message') {
                store.watchedMessages.set(args[0], message.guild.id);
                store.guilds.set(message.guild.id, args[0], 'verificationMessage');
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: 'Watched message updated!'
                }));
                return;
            }

            // Set the verification queue channel
            if (command === 'set-queue-channel') {
                // Make sure we have the channel we're asking for
                const channel = message.guild.channels.cache.find(channel => channel.id === message.mentions.channels.first()?.id ?? args[0]);
                if (!channel) {
                    await message.channel.send(new MessageEmbed({
                        color: colours.RED,
                        description: `No channel found for \`${args[0]}\`!`
                    }));
                    return;
                }

                store.guilds.set(message.guild.id, channel.id, 'queueChannel');
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `Queue channel set to \`${channel.name}\`!`
                }));
                return;
            }

            // Set the verification audit-log channel
            if (command === 'set-audit-log-channel') {
                // Make sure we have the channel we're asking for
                const channel = message.guild.channels.cache.find(channel => channel.id === message.mentions.channels.first()?.id ?? args[0]);
                if (!channel) {
                    await message.channel.send(new MessageEmbed({
                        color: colours.RED,
                        description: `No channel found for \`${args[0]}\`!`
                    }));
                    return;
                }

                store.guilds.set(message.guild.id, channel.id, 'auditLogChannel');
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `AuditLog channel set to \`${channel.name}\`!`
                }));
                return;
            }

            // Set the verification announcement channel
            if (command === 'set-announcement-channel') {
                // Make sure we have the channel we're asking for
                const channel = message.guild.channels.cache.find(channel => channel.id === message.mentions.channels.first()?.id ?? args[0]);
                if (!channel) {
                    await message.channel.send(new MessageEmbed({
                        color: colours.RED,
                        description: `No channel found for \`${args[0]}\`!`
                    }));
                    return;
                }

                store.guilds.set(message.guild.id, channel.id, 'announcementChannel');
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `Announcement channel set to \`${channel.name}\`!`
                }));
                return;
            }

            // Set the roles verified members get
            if (command === 'set-verified-roles') {
                // Make sure we have the roles we're asking for
                const roles = message.mentions.roles
                    .map(role => message.guild!.roles.cache.find(cachedRole => cachedRole.id === role.id)?.id)
                    .filter(role => role);
                if (roles.length === 0) {
                    await message.channel.send(new MessageEmbed({
                        color: colours.RED,
                        description: `No roles found for \`${args.join(' ')}\`!`
                    }));
                    return;
                }

                store.guilds.set(message.guild.id, roles, 'roles');
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `Verified roles set to \`${roles.join(' ')}\`!`
                }));
                return;
            }
        }
    }
}