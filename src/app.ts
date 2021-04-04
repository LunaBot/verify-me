import { Channel, Client, DMChannel, Message, MessageEmbed, TextChannel } from 'discord.js';
import { logger } from './logger';
import { config } from './config';
import EnhancedMap from 'enmap';
import dedent from 'dedent';

const isTextBasedChannel = (channel?: Channel): channel is TextChannel => channel?.type === 'text';
const sleep = (ms: number) => new Promise<void>(resolve => {
    setTimeout(() => {
        resolve();
    }, ms);
});

const colours = {
    AQUA: 1752220,
    RED: 15158332,
    GREEN: 3066993,
    ORANGE: 15105570,
    BLURPLE: 7506394
};

const guildsDefaultOptions = {
    prefix: '!',
    adminRole: 'Admin',
    auditLogChannel: null,
    queueChannel: null,
    verificationMessage: null,
    ticketNumber: 0,
    padding: 5,
    roles: []
};
const guilds = new EnhancedMap({
    name: 'guilds',
    fetchAll: false,
    autoFetch: true,
    cloneLevel: 'deep',
    // @ts-expect-error
    autoEnsure: guildsDefaultOptions
});

const members = new EnhancedMap({
    name: 'members',
    fetchAll: false,
    autoFetch: true,
    cloneLevel: 'deep',
    // @ts-expect-error
    autoEnsure: {
        state: null
    }
});
const watchedMessages = new EnhancedMap('watched-messages');

interface Question {
    text: string;
    emoji?: string;
    validator: (message: Message) => boolean;
    formatter: (message: Message) => any;
    canSkipCheck?: (message: Message) => any;
    failureMessage?: string;
};

const waitForQuestions = async (originalMessage: Message, userId: string, guildId: string, channel: TextChannel, questions: Question[], index: number = 0, results: any[] = []): Promise<any[]> => {
    const question = questions[index];

    // Return results when done
    if (!question) return results;

    // Check if we can skip this question
    if (question.canSkipCheck && question.canSkipCheck(originalMessage)) return waitForQuestions(originalMessage, userId, guildId, channel, questions, index + 1, {
        ...results,
        [index]: question.formatter(originalMessage)
    });

    // Ask question
    await channel.send(new MessageEmbed({
        color: colours.BLURPLE,
        description: `${question.emoji ?? '❓'} ${question.text}`
    }));

    // Wait for answer
    const collected = await channel.awaitMessages(m => m.author.id === userId, {
        // Only collect a single message at a time
        max: 1,
        // One minute
        time: 60 * 1000,
        errors: ['time']
    }).then(response => response.first()).catch(async () => {
        members.set(`${guildId}_${userId}`, 'closed', 'state');
        await channel.send(new MessageEmbed({
            author: {
                name: '⌛ Verification timed out!'
            }
        })).catch(() => {});
    });

    // Timed-out
    if (!collected) return waitForQuestions(originalMessage, userId, guildId, channel, questions, index + 1, results);

    // Cancelled
    if (collected.content.toLowerCase().startsWith('!cancel')) {
        await channel.send(new MessageEmbed({
            author: {
                name: '❌ Verification cancelled!'
            }
        }));

        // Bail with the results we currently have
        return results;
    }

    // Check response was valid
    if (!question.validator(collected)) {
        // Invalid response
        await channel.send(new MessageEmbed({
            author: {
                name: `❌ ${question.failureMessage ?? 'Invalid response, try again!'}`
            }
        }));

        // Resend question
        return waitForQuestions(originalMessage, userId, guildId, channel, questions, index, results);
    }

    return waitForQuestions(originalMessage, userId, guildId, channel, questions, index + 1, {
        ...results,
        [index]: question.formatter(collected)
    });
};

export const start = async () => {
    const client = new Client();

    client.on('ready', () => {
        logger.info('BOT:READY');
    });

    client.on('error', (error) => {
        logger.error(error);
    });

    // Patch client to emit on all message reaction add/remove events not just ones for cached messages
    client.on('raw', packet => {
        // We don't want this to run on unrelated packets
        if (!['MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE'].includes(packet.t)) return;
        // Grab the channel to check the message from
        const channel = client.channels.cache.get(packet.d.channel_id);
        // Ensure this is a text channel
        if (!isTextBasedChannel(channel)) return;
        // There's no need to emit if the message is cached, because the event will fire anyway for that
        if (channel.messages.cache.has(packet.d.message_id)) return;
        // Since we have confirmed the message is not cached, let's fetch it
        channel.messages.fetch(packet.d.message_id).then(message => {
            // Emojis can have identifiers of name:id format, so we have to account for that case as well
            const emoji = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name;
            // This gives us the reaction we need to emit the event properly, in top of the message object
            const reaction = message.reactions.cache.get(emoji);
            // Adds the currently reacting user to the reaction's users collection.
            if (reaction) {
                reaction.users.cache.set(packet.d.user_id, client.users.cache.get(packet.d.user_id)!);
                // Check which type of event it is before emitting
                if (packet.t === 'MESSAGE_REACTION_ADD') {
                    client.emit('messageReactionAdd', reaction, client.users.cache.get(packet.d.user_id)!);
                }
                if (packet.t === 'MESSAGE_REACTION_REMOVE') {
                    client.emit('messageReactionRemove', reaction, client.users.cache.get(packet.d.user_id)!);
                }
            }
        });
    });

    client.on('message', async (message) => {
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
                    guilds.set(message.guild.id, role.id, 'adminRole');
                    await message.channel.send(new MessageEmbed({
                        description: `Admin role updated to \`${role.name}\`!`
                    }));
                    return;
                }

                // Allow guild to be reset
                if (command === 'clear-watched-messages') {
                    const verificationMessageId = guilds.get(message.guild.id, 'verificationMessage');

                    // Clear all watched messages for this guild
                    [...watchedMessages.entries()].forEach(([messageId, guildId]) => {
                        // Ensure we clear all in this guild but
                        // don't clear the verification message watcher as we need that
                        if (guildId === message.guild?.id && message.id !== verificationMessageId) {
                            watchedMessages.delete(messageId);
                        }
                    });

                    return;
                }

                // Allow ticket number to be reset
                if (command === 'reset-counter') {
                    // Reset ticket number
                    guilds.set(message.guild.id, 0, 'ticketNumber');
                    return;
                }

                // Dump the whole config for them
                if (command === 'show-config') {
                    await message.channel.send(new MessageEmbed({
                        color: colours.GREEN,
                        description: '```\n' + JSON.stringify(guilds.get(message.guild.id), null, 2) +  '\n```'
                    }));
                    return;
                }
            }

            // If they're an admin let them change settings
            if (message.member?.roles.cache.find(role => role.id === guilds.get(message.guild!.id, 'adminRole'))) {
                // Set the watched message
                if (command === 'watch') {
                    watchedMessages.set(args[0], message.guild.id);
                    guilds.set(message.guild.id, args[0], 'verificationMessage');
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

                    guilds.set(message.guild.id, channel.id, 'queueChannel');
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

                    guilds.set(message.guild.id, channel.id, 'auditLogChannel');
                    await message.channel.send(new MessageEmbed({
                        color: colours.GREEN,
                        description: `AuditLog channel set to \`${channel.name}\`!`
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

                    guilds.set(message.guild.id, roles, 'roles');
                    await message.channel.send(new MessageEmbed({
                        color: colours.GREEN,
                        description: `Verified roles set to \`${roles.join(' ')}\`!`
                    }));
                    return;
                }
            }
        }

        // Unknown command?
        await message.channel.send(new MessageEmbed({
            description: `Unknown command "${command}"`
        }));
    });

    client.on('messageReactionAdd', async (messageReaction, user) => {
        // Only process messages we care about
        if (!watchedMessages.has(messageReaction.message.id)) return;

        // Get whole user
        if (user.partial) await user.fetch();

        // If we're in the queue channel then make sure it's an admin, if so then they're likely allowing/denying a verification
        if (messageReaction.message.channel.id === guilds.get(messageReaction.message.guild?.id!, 'queueChannel')) {
            // Bail if it's not an admin
            if (!messageReaction.message.guild?.members.cache.get(user.id)?.roles.cache.find(role => role.id === guilds.get(messageReaction.message.guild?.id!, 'adminRole'))) return;
            // Attempt to get the member ID
            const memberId = messageReaction.message.embeds[0].fields.find(field => field.name === 'ID')?.value;

            // Make sure this is one of our embeds
            if (!memberId) return;
            
            // Get member
            const member = messageReaction.message.guild.members.cache.get(memberId!);

            // Approved
            if (messageReaction.emoji.name === '👍') {
                // Get role to add to member
                const roleIds = guilds.get(messageReaction.message.guild?.id!, 'roles');
                const roles = roleIds.map(roleId => messageReaction.message.guild?.roles.cache.get(roleId)).filter(role => role);

                // Make sure the role exists
                if (roles.length === 0) return;

                // Try to add all the roles to the member
                await Promise.allSettled(roles.map(role => member?.roles.add(role)));

                // Get ticket number
                const ticketNumber = messageReaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

                // Mark verified
                members.set(`${messageReaction.message.guild?.id}_${member?.id}`, 'verified', 'state');

                // Log ticket approved
                logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'APPROVED');

                // Let the member know
                await member?.send(new MessageEmbed({
                    color: colours.GREEN,
                    author: {
                        name: '🚀 Verification approved!'
                    },
                    fields: [{
                        name: 'Guild',
                        value: messageReaction.message.guild.name
                    }, {
                        name: 'Ticket #',
                        value: `${ticketNumber}`.padStart(5, '0')
                    }],
                    description: 'Your verification was approved!'
                }));
            }

            // Redo
            if (messageReaction.emoji.name === '🔁') {
                // Get ticket number
                const ticketNumber = messageReaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

                // Reset member's state
                members.set(`${messageReaction.message.guild?.id}_${member?.id}`, 'closed', 'state');

                // Log ticket redo
                logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'REDO');

                // Let the member know
                await member?.send(new MessageEmbed({
                    color: colours.RED,
                    author: {
                        name: '🚀 Verification denied!'
                    },
                    fields: [{
                        name: 'Guild',
                        value: messageReaction.message.guild.name
                    }, {
                        name: 'Ticket #',
                        value: `${ticketNumber}`.padStart(5, '0')
                    }],
                    description: 'Don\'t worry though as you\'re able to redo it, just visit the server where you applied and retry.'
                }));
            }

            // Denied
            if (messageReaction.emoji.name === '👎') {
                // Get ticket number
                const ticketNumber = messageReaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

                // Ensure the user can't apply again
                members.set(`${messageReaction.message.guild?.id}_${member?.id}`, 'denied', 'state');

                // Log ticket denied
                logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'DENIED');

                // Let the member know
                await member?.send(new MessageEmbed({
                    author: {
                        name: '🚀 Verification denied!'
                    },
                    fields: [{
                        name: 'Guild',
                        value: messageReaction.message.guild.name
                    }, {
                        name: 'Ticket #',
                        value: `${ticketNumber}`.padStart(5, '0')
                    }],
                    description: 'Your verification was denied!'
                }));

                // Wait 1s
                await sleep(1000);

                // Kick the member
                await member?.kick();
            }

            // Get audit-log channel
            const auditLogChannelId = guilds.get(messageReaction.message.guild?.id!, 'auditLogChannel');
            const auditLogChannel = messageReaction.message.guild?.channels.cache.find(channel => channel.id === auditLogChannelId) as TextChannel;

            // Get ticket number
            const ticketNumber = messageReaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

            // Post in audit-log
            await auditLogChannel.send(new MessageEmbed({
                color: messageReaction.emoji.name === '👍' ? colours.GREEN : (messageReaction.emoji.name === '👎' ? colours.RED : colours.ORANGE),
                author: {
                    name: `Ticket number #${`${ticketNumber}`.padStart(5, '0')}`,
                    iconURL: member?.user.displayAvatarURL()
                },
                fields: [{
                    name: 'Username',
                    value: member?.user.username,
                    inline: true
                }, {
                    name: 'Discriminator',
                    value: member?.user.discriminator,
                    inline: true
                }, {
                    name: 'Default avatar',
                    value: member?.user.displayAvatarURL() ? 'Yes' : 'No',
                    inline: true
                }, {
                    name: 'ID',
                    value: memberId,
                    inline: true
                }, {
                    name: 'Ticket number',
                    value: ticketNumber,
                    inline: true
                }, {
                    name: 'State',
                    value: messageReaction.emoji.name === '👍' ? 'approved' : (messageReaction.emoji.name === '👎' ? 'denied' : 'pending redo'),
                    inline: true
                }]
            }));

            // Delete the queued verification message
            await messageReaction.message.delete();
            return;
        }

        // Reset verification
        if (messageReaction.emoji.name === '🔄') {
            members.set(`${messageReaction.message.guild?.id}_${user.id}`, 'closed', 'state');
        }

        // Don't allow people to open a second if they already have a verification running
        if (members.get(`${messageReaction.message.guild?.id}_${user.id}`, 'state') === 'open') {
            await user.send(new MessageEmbed({
                description: '❌ You already have a verification ticket open!',
                color: colours.RED
            }));
            return;
        }

        // Remove the reaction
        await messageReaction.users.remove(user.id);

        // Don't allow people to verify twice
        if (members.get(`${messageReaction.message.guild?.id}_${user.id}`, 'state') === 'verified') {
            await user.send(new MessageEmbed({
                description: '❌ You\'re already verified!',
                color: colours.RED
            }));
            return;
        }

        // Don't allow people to verify while they have a verification pending
        if (members.get(`${messageReaction.message.guild?.id}_${user.id}`, 'state') === 'pending') {
            await user.send(new MessageEmbed({
                description: '❌ Your verification has already been submitted to the queue, please wait!',
                color: colours.RED
            }));
            return;
        }

        // Set message state to open
        members.set(`${messageReaction.message.guild?.id}_${user.id}`, 'open', 'state');

        // Get current ticket number
        const ticketNumber: number = (guilds.inc(messageReaction.message.guild!.id, 'ticketNumber') as any).get(messageReaction.message.guild!.id).ticketNumber;

        // Log ticket open
        logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'OPEN');

        // Send a DM to the user
        const message = await user.send(new MessageEmbed({
            author: {
                name: '✏️ Verification started!'
            },
            color: colours.AQUA,
            description: dedent`
                This server is **strictly 18+** If you're underage please leave immediately!  

                Type \`!cancel\` to exit.
            `
        }));

        const questions = [{
            emoji: '❌',
            text: dedent`
                Please set a profile image before continuing with this verification!
                Click [here](https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-) for more information.
                Once done reply here and I'll check. :smiley:
            `,
            validator: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            formatter: (message: Message) => {
                return `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.jpg`;
            },
            canSkipCheck: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            failureMessage: 'No profile image detected!'
        }, {
            text: 'How old are you?',
            validator: (message: Message) => {
                const age = parseInt(message.content, 10);
                return (age >= 18) && (age <= 100);
            },
            formatter: (message: Message) => parseInt(message.content, 10)
        }, {
            text: 'Are you wanting to sell adult content in this server?',
            validator: (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase()),
            formatter: (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase())
        }, {
            text: `Please send a photo of yourself holding a piece of paper with today's date, the text "I'm joining the lobby" and your **DISCORD** username.`,
            validator: (message: Message) => message.attachments.size === 1,
            formatter: (message: Message) => message.attachments.first()?.url
        }];

        // Wait for verification
        const replies = await waitForQuestions(message, user.id, message.guild?.id!, message.channel as TextChannel, questions);

        // Get the guild's queue channel id
        const queueChannelId = guilds.get(messageReaction.message.guild?.id!, 'queueChannel');

        // Send error to the owner
        if (!queueChannelId) {
            await messageReaction.message.guild?.owner?.send(new MessageEmbed({
                author: {
                    name: `❌ No queue channel set in ${messageReaction.message.guild.name}`
                },
                description: 'Use `!set-queue-channel` to set it!'
            }));
            return;
        }

        // Get queue channel
        const queueChannel = messageReaction.message.guild?.channels.cache.find(channel => channel.id === queueChannelId) as TextChannel;

        // Timed-out or cancelled
        if (Object.values(replies).length < questions.length) {
            // Log ticket timed-out
            logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'TIMED_OUT_OR_CANCEL');
            return;
        }

        // Set verification as pending
        members.set(`${messageReaction.message.guild?.id}_${user.id}`, 'pending', 'state');

        // Log ticket pending
        logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'PENDING');

        // Send message to queue channel for mods/admins to verify
        const verification = await queueChannel.send(new MessageEmbed({
            author: {
                name: `Ticket number #${`${ticketNumber}`.padStart(5, '0')}`,
                iconURL: messageReaction.message.guild?.members.cache.find(member => member.id === user.id)?.user.displayAvatarURL()
            },
            fields: [{
                name: 'Username',
                value: user.username,
                inline: true
            }, {
                name: 'Discriminator',
                value: user.discriminator,
                inline: true
            }, {
                name: 'Age',
                value: replies[1],
                inline: true
            }, {
                name: 'ID',
                value: user.id,
                inline: true
            }, {
                name: 'Seller?',
                value: replies[2] ? 'Yes' : 'No',
                inline: true
            }, {
                name: 'Ticket number',
                value: ticketNumber,
                inline: true
            }],
            image: {
                url: replies[3]
            }
        }));

        // Add approve, redo and deny reactions
        await verification.react('👍');
        await verification.react('🔁');
        await verification.react('👎');

        // Add verfication message to the watched messages list
        watchedMessages.set(verification.id, verification.guild!.id);

        // Success?
        await user.send(new MessageEmbed({
            color: colours.GREEN,
            author: {
                name: '🚀 Verification submitted!'
            },
            fields: [{
                name: 'Guild',
                value: messageReaction.message.guild?.name
            }, {
                name: 'Ticket #',
                value: `${ticketNumber}`.padStart(5, '0')
            }],
            description: 'Once your verification has been accepted you\'ll get a message here from me.'
        }));
    });

    client.login(config.botToken);
};