import { DiscordAPIError, Guild as DiscordGuild, GuildMember, Message, MessageEmbed } from "discord.js";
import { colours } from "../utils";
import { startVerification } from "../utils/start-verification";
import { waitForAnswer } from "../utils/start-verification/waitForAnswer";
import { client } from "../client";
import { createEmbed } from "../utils/create-embed";
import { getTicketStatus, deserializeGuild, deserializeTicket, getGuild, getTicket, getTicketKeys, serialize, updateGuild, deserialize, updateTicketStatus, defaultGuild, Guild } from "../store";

export const onMessage = async function onMessage (message: Message) {
    // Don't process bot messages
    if (message.author.bot) return;

    // Get command and arguments
    const [command, ...args] = message.content.slice(1).trim().split(/ +/);

    // Process DM
    if (!message.guild && message.author) {
        try {
            // Bail if user is in ticket
            const hasTicketOpen = await getTicketStatus(`user_ticket_opened:${message.author.id}`, '.').then(string => deserialize<boolean>(string)).catch(() => false);
            if (hasTicketOpen) return;

            // Bail if a member has started a message with us
            const isInMessage = await getTicketStatus(`user_in_message:${message.author.id}`, '.').then(string => deserialize<boolean>(string)).catch(() => false);
            if (isInMessage) return;

            // Bail if this isn't a start command
            if (command !== 'start' && command !== 'verify' && command !== 'verification') return;

            // User is in a message with us
            await updateTicketStatus(`is_in_message:${message.author.id}`, '.', serialize<boolean>(true));

            // Ask what server they want to verify with
            const guild = await waitForAnswer<DiscordGuild | undefined>({
                user: message.author,
                question: 'Which server are you verifying for?',
                validator: (message: Message) => {
                    return Object.values({
                        the_lobby: message.content.trim().toLowerCase().includes('lobby'),
                        star_hub: message.content.trim().toLowerCase().includes('star')
                    }).filter(entry => entry === true).length >= 1;
                },
                formatter: (message: Message) => {
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
            const member = guild?.members.cache.get(message.author.id) ?? await guild?.members.fetch(message.author.id).catch((error: DiscordAPIError) => error);

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

            // Get all tickets for this user
            // ticket:$guildId:$memberId:$ticketId
            const ticketKeys = await getTicketKeys(`${guild.id}:${(member as GuildMember).id}:*`);
            if (ticketKeys.length >= 1) {
                const tickets = await Promise.all(ticketKeys.map(ticketKey => getTicket(ticketKey, '.').then(deserializeTicket)));
                const pendingTickets = tickets.filter(ticket => ticket.type === 'VERIFICATION' && (ticket.state === 'PENDING' || ticket.state === 'PENDING_REDO'));
                const deniedTickets = tickets.filter(ticket => ticket.type === 'VERIFICATION' && (ticket.state === 'DENIED'));

                // Check if the member has a verification ticket open
                if (pendingTickets.length >= 1) {
                    await message.channel.send(new MessageEmbed({
                        description: '❌ Your verification has already been submitted to the queue, please wait!',
                        color: colours.RED
                    }));
                    return;
                }

                // Check if the member has been blocked from applying from verifying
                if (deniedTickets.length >= 1) {
                    await message.channel.send(new MessageEmbed({
                        description: '❌ You\'ve been blocked from applying to this server. Please contact the mods/admins for further information.',
                        color: colours.RED
                    }));
                    return;
                }
            }

            // Start verification
            return startVerification(member as GuildMember);
        } catch (error) {
            if (error.message === 'CANCELLED') {
                const embed = createEmbed({ author: '🚫 Verification cancelled!' });
                await message.author.send(embed).catch(() => {});
                return;
            }

            throw error;
        } finally {
            // User is no longer in a message with us
            await updateTicketStatus(`is_in_message:${message.author.id}`, '.', serialize<boolean>(false));
        }
    }

    // Process guild message
    if (message.guild) {
        // Get guild from db
        const guild = await getGuild(message.guild.id, '.').then(deserializeGuild) ?? await updateGuild(message.guild.id, '.', serialize<Partial<Guild>>({
            ...defaultGuild,
            guildId: message.guild.id
        }));

        // Bail if the message is missing our prefix
        if (!message.content.startsWith(guild?.prefix || '!')) return;

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
                await updateGuild(message.guild.id, '.adminRole', role.id);
                await message.channel.send(new MessageEmbed({
                    description: `Admin role updated to \`${role.name}\`!`
                }));
                return;
            }

            // Allow ticket number to be reset
            if (command === 'reset-counter') {
                // Reset ticket number
                await updateGuild(message.guild.id, '.ticketNumber', 0);
                return;
            }

            // Dump the whole config for them
            if (command === 'show-config') {
                const config = await getGuild(message.guild.id, '.').then(deserialize);
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: '```\n' + JSON.stringify(config, null, 2) +  '\n```'
                }));
                return;
            }

            // Set the config to a new JSON string
            if (command === 'set-config') {
                try {
                    // Update store
                    await updateGuild(message.guild.id, '.', JSON.stringify(JSON.parse(message.content.split(command)[1])));

                    // Get config
                    const config = await getGuild(message.guild.id, '.').then(deserialize);

                    // Send config to client
                    await message.channel.send(new MessageEmbed({
                        color: colours.GREEN,
                        description: '```\n' + JSON.stringify(config, null, 2) +  '\n```'
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
        if (message.member?.roles.cache.find(role => role.id === guild.adminRole)) {
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

                await updateGuild(message.guild.id, '.queueChannel', channel.id);
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

                await updateGuild(message.guild.id, '.auditLogChannel', channel.id);
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

                await updateGuild(message.guild.id, '.announcementChannel', channel.id);
                await message.channel.send(new MessageEmbed({
                    color: colours.GREEN,
                    description: `Announcement channel set to \`${channel.name}\`!`
                }));
                return;
            }
        }
    }
}