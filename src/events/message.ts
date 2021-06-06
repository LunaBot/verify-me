import dedent from "dedent";
import { DiscordAPIError, Guild, Message, MessageEmbed } from "discord.js";
import { colours } from "../utils";
import { store } from "../store";
import { startVerification, waitForAnswer } from "utils/start-verification";
import { client } from "../client";

export const onMessage = async function onMessage (message: Message) {
    // Don't process bot messages
    if (message.author.bot) return;

    // Get command and arguments
    const [command, ...args] = message.content.slice(1).trim().split(/ +/);

    // Process DM
    if (!message.guild && message.author) {
        // Reset stuck bot
        if (command === 'reset') {
            store.members.delete(message.author.id, 'waiting-reply');
            await message.channel.send(new MessageEmbed({
                description: '✅ Ticket state reset!',
                color: colours.AQUA
            }));
            return;
        }

        // Bail if a collector is waiting for their reply
        if (store.members.get(message.author.id, 'waiting-reply')) {
            return;
        }

        // Bail if this isn't a start command
        if (command !== 'start' && command !== 'verify' && command !== 'verification') return;

        // Ask what server they want to verify with
        const guild = await waitForAnswer<Guild | undefined>({
            user: message.author,
            question: 'Which server are you verifying for?',
            validator: message => {
                return Object.values({
                    the_lobby: message.content.trim().toLowerCase().includes('lobby'),
                    star_hub: message.content.trim().toLowerCase().includes('star')
                }).filter(entry => entry === true).length >= 1;
            },
            formatter: message => {
                const guild = Object.entries({
                    the_lobby: message.content.trim().toLowerCase().includes('lobby'),
                    star_hub: message.content.trim().toLowerCase().includes('star')
                }).find(entry => entry[1] === true)?.[0];

                if (guild === 'the_lobby') {
                    return client.guilds.cache.find(guild => guild.id === '776567290907852840');
                }

                if (guild === 'star_hub') {
                    return client.guilds.cache.find(guild => guild.id === '847481771456987136');
                }

                return undefined;
            }
        });

        // Check if bot is in the guild
        if (!guild) {
            await message.channel.send(new MessageEmbed({
                color: colours.AQUA,
                description: `Please let my creator I'm not currently added to that server.`
            }));
            return;
        }

        // Get member from the guild provided
        const member = guild?.members.cache.get(message.author.id) ?? await guild?.members.fetch(message.author.id).catch(error => error);

        // Check if there was an error
        if (!member || member instanceof DiscordAPIError) {
            // User isn't a member of that guild
            if (!member || member.message === 'Unknown Member') {
                await message.channel.send(new MessageEmbed({
                    color: colours.AQUA,
                    description: `Please join ${guild?.name} before verifying!`
                }));
                return;
            }
        }

        // Get ticket state
        const ticketState = store.members.get(`${member.guild.id}_${message.author.id}`, 'state');

        // Check if the member has a ticket already open
        if (ticketState === 'PENDING') {
            await message.channel.send(new MessageEmbed({
                description: '❌ Your verification has already been submitted to the queue, please wait!',
                color: colours.RED
            }));
            return;
        }

        // Check if the member has been blocked from applying
        if (ticketState === 'DENIED') {
            await message.channel.send(new MessageEmbed({
                description: '❌ You\'ve been blocked from applying to this server. Please contact the mods/admins for further information.',
                color: colours.RED
            }));
            return;
        }

        // Start verification
        return startVerification(member);
    }

    // Bail if the message is missing our prefix
    if (!message.content.startsWith(store.guilds.get(message.guild?.id!).prefix ?? '!')) return;

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

            // Set the config to a new JSON string
            if (command === 'set-config') {
                try {
                    // Parse supplied config
                    const config = JSON.parse(message.content.split(command)[1]);
                    // Update store
                    store.guilds.set(message.guild.id, config);
                    await message.channel.send(new MessageEmbed({
                        color: colours.GREEN,
                        description: '```\n' + JSON.stringify(store.guilds.get(message.guild.id), null, 2) +  '\n```'
                    }));
                } catch {
                    await message.channel.send(new MessageEmbed({
                        color: colours.RED,
                        description: 'Failed updated config.'
                    }));
                }
                return;
            }
        }

        // If they're an admin let them change settings
        if (message.member?.roles.cache.find(role => role.id === store.guilds.get(message.guild!.id as string, 'adminRole'))) {
            // Set member's ticket state
            if (command === 'set-members-ticket-state') {
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `Ticket state updated for <@${args[0]}>!`
                }));
                console.log(`${message.member.guild.id}_${args[0]}`, args[1], 'state');
                store.members.set(`${message.member.guild.id}_${args[0]}`, args[1], 'state');
                return;
            }

            // Set the verification queue channel
            if (command === 'set-verification-queue-channel') {
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
        }
    }
}