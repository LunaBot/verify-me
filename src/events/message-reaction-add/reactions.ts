import dedent from 'dedent';
import { GuildMember, MessageEmbed, MessageReaction } from 'discord.js';
import linkify from 'markdown-linkify';
import { logger } from '../../logger';
import { colours, isTextBasedChannel, sleep } from '../../utils';
import { getAgeRole } from "./get-age-role";
import { createEmbed } from '../../utils/create-embed';
import { deserializeGuild, getGuild, serialize, updateTicket } from '../../store';

const getDmPreferenceRole = async (guildId: string, dmPreference: 'ask before dming' | 'dms are open' | 'do not dm'): Promise<string | undefined> => {
    const guild = await getGuild(guildId, '.').then(deserializeGuild);
    const dmRoles = guild.dmRoles;

    if (dmPreference === 'ask before dming') return dmRoles.ask;
    if (dmPreference === 'dms are open') return dmRoles.open;
    if (dmPreference === 'do not dm') return dmRoles.closed;
    return;
};

export const reactions = {
    // Approve ticket in queue
    async '👍'(reaction: MessageReaction, member: GuildMember) {
        // Get guild
        const guild = await getGuild(member.guild.id, '.').then(deserializeGuild);

        // Get member role ID
        const memberRoleId = guild.memberRole;

        // No member role set in config
        if (!memberRoleId) {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods no "member" role has been set in the config.` });
            await reaction.message.channel.send(embed).catch(() => {});
            return;
        }

        // Get member role
        const memberRole = reaction.message.guild?.roles.cache.get(memberRoleId);

        // No member role found
        if (!memberRole) {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods no "member" role found for the provided ID.` });
            await reaction.message.channel.send(embed).catch(() => {});
            return;
        }

        // Try to add the member role
        await member.roles.add(memberRole);

        // Get ticket number
        const ticketNumber = parseInt(reaction.message.embeds[0].footer?.text?.match(/Ticket \#([0-9]+)/)![1]!, 10);

        // Is the member a seller?
        const seller = reaction.message.embeds[0].fields.find(field => field.name.toLowerCase() === 'seller?')?.value.includes('checkmark');

        // Get the person's links
        const links = seller ? linkify(reaction.message.embeds[0].fields.find(field => field.name.toLowerCase() === 'links')?.value) as string : undefined;

        // Give the seller roles
        // @todo: fix this for seller hub
        if (reaction.message.guild!.id === '776567290907852840') {
            if (seller) {
                // Get discord roles
                const sellerRole = member.guild.roles.cache.find(role => role.id === '776567998466228254');

                // Add server seller role
                if (sellerRole) {
                    await member.roles.add(sellerRole);
                }

                // Did they provided a reddit verification post link?
                const reddit = reaction.message.embeds[0].fields.find(field => field.name.toLowerCase() === 'links')?.value.split('\n').find(line => {
                    return line.toLowerCase().startsWith('reddit');
                });
                if (reddit?.includes('reddit.com/r/horny')) {
                    const redditSellerRole = member.guild.roles.cache.find(role => role.id === '783282529737900034');

                    // Add reddit seller role
                    if (redditSellerRole) {
                        await member.roles.add(redditSellerRole);
                    }

                    // @TODO: Give the seller role on reddit
                }
            }
        } else {
            if (seller) {
                // Get seller role ID
                const sellerRoleId = guild.sellerRole;

                // No seller role set
                if (!sellerRoleId) {
                    const embed = createEmbed({ author: `🚫 Please contact the admins/mods no "seller" role has been set in the config.` });
                    await reaction.message.channel.send(embed).catch(() => {});
                    return;
                }

                // Get seller role
                const sellerRole = reaction.message.guild?.roles.cache.get(sellerRoleId);

                // Add seller role
                if (sellerRole) {
                    await member.roles.add(sellerRole);
                }
            }
        }

        // Get member's age
        const age = parseInt(reaction.message.embeds[0].fields.find(field => field.name.toLowerCase() === 'age')?.value!, 10);

        // Get age role
        const ageRole = await getAgeRole(reaction.message.guild?.id!, age);

        // Give age role
        if (ageRole) {
            await member.roles.add(ageRole);
        }

        // Get member's DM preference
        const dmPreference = reaction.message.embeds[0].fields.find(field => field.name.toLowerCase() === 'dm preference')?.value!.toLowerCase();

        // Get DM preference role
        const dmPreferenceRole = await getDmPreferenceRole(reaction.message.guild?.id!, dmPreference?.toLowerCase() as any);

        // Give DM preference role
        if (dmPreferenceRole) {
            await member.roles.add(dmPreferenceRole);
        }

        // Mark verified
        await updateTicket(`ticket:${member.user.id}:${ticketNumber}`, '.state', serialize<string>('VERIFIED'));

        // Log ticket approved
        logger.debug(`TICKET:${ticketNumber}`, 'APPROVED');

        // Mention the user in the chat channel
        const announcementChannelId = guild.announcementChannel;
        const announcementChannel = reaction.message.guild!.channels.cache.get(announcementChannelId);

        // Post announcement that the member was approved
        if (isTextBasedChannel(announcementChannel)) {
            // @todo: move this to server settings
            // This is a legacy feature for the lobby
            if (reaction.message.guild!.id === '776567290907852840') {
                // Send message
                await announcementChannel.send(`<@&836464776401649685> | <@${member?.id}>`, {
                    embed: new MessageEmbed({
                        color: colours.GREEN,
                        description: dedent`
                            **__Welcome to ${reaction.message.guild?.name}__**

                            ➜ Make sure to read the <#805318568706441228>
                            ➜ Introduce yourself in <#780369802262478849>
                            ➜ Get some roles from our <#781083640025186304>
                            ➜ Try some of our <#831508428542967828> and win some :coin:
                            ➜ If you enjoy the server please remember to <#818703159199399946>
                            ${seller ? dedent`
                            ➜ You now have access to <#835525672494825542> <#835525809867456543> and <#835547717672632352>
                            ➜ To gain access to <#831493908050477106> visit our <#831494130467209216>
                            ` : ''}

                            **We now have ${reaction.message.guild?.memberCount} members!**
                        `
                    })
                });
            } else {
                // Get welcome role ID
                const welcomeRoleId = guild.welcomeRole;

                // No welcome role set
                if (!welcomeRoleId) {
                    const embed = createEmbed({ author: `🚫 Please contact the admins/mods no "welcome" role has been set in the config.` });
                    await reaction.message.channel.send(embed).catch(() => {});
                    return;
                }

                // Ensure we have all members fetched
                await reaction.message.guild?.members.fetch();

                // Get seller role ID
                const sellerRoleId = guild.sellerRole;

                // No seller role set
                if (!sellerRoleId) {
                    const embed = createEmbed({ author: `🚫 Please contact the admins/mods no "seller" role has been set in the config.` });
                    await reaction.message.channel.send(embed).catch(() => {});
                    return;
                }

                // Get total count of sellers with the role
                const sellerRoleCount = reaction.message.guild?.roles.cache.get(sellerRoleId)?.members.size;

                // Post that a new seller has joined
                await announcementChannel.send(`<@&${welcomeRoleId}> | <@${member?.id}>`, {
                    embed: new MessageEmbed({
                        color: colours.GREEN,
                        description: dedent`
                            **__A new seller just joined!__**

                            ${links!.split('\n').map(link => '➜ ' + link).join('\n')}

                            **We now have ${sellerRoleCount} sellers!**
                        `
                    })
                });
            }

            // @todo: move this to server settings
            // This is a legacy feature for the lobby
            if (reaction.message.guild!.id === '776567290907852840') {
                // Get hell channel
                const hellChannel = reaction.message.guild?.channels.cache.get('834664630268723201');
                if (seller && links && links?.includes('onlyfans.com') && isTextBasedChannel(hellChannel)) {
                    // Ensure we have all members fetched
                    await reaction.message.guild?.members.fetch();

                    // Get total count of sellers with the role
                    const sellerRoleCount = reaction.message.guild?.roles.cache.get('776567998466228254')?.members.size;

                    // Post in Hell about their links
                    await hellChannel.send(`<@&814042724227350530> | <@${member?.id}>`, {
                        embed: new MessageEmbed({
                            color: colours.GREEN,
                            description: dedent`
                                **__A new seller just joined!__**

                                ${links.split('\n').map(link => '➜ ' + link).join('\n')}
                                ➜ If you enjoy their content please make sure post in <#811023380294926399>

                                **We now have ${sellerRoleCount} sellers!**
                            `
                        })
                    });
                }
            }
        }

        // Let the member know
        await member?.send(new MessageEmbed({
            color: colours.GREEN,
            author: {
                name: `🚀 Verification approved for ${reaction.message.guild!.name}!`
            },
            description: 'I hope you enjoy your day. :slight_smile:',
            footer: {
                text: `Ticket #${ticketNumber}`
            }
        })).catch(error => {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`, 'MEMBER_LEFT');
        });
    },
    // Ask member to redo ticket in queue
    async '🔁'(reaction: MessageReaction, member: GuildMember) {
        // Get ticket number
        const ticketNumber = parseInt(reaction.message.embeds[0].footer?.text?.match(/Ticket \#([0-9]+)/)![1]!, 10);

        // Mark as redo
        await updateTicket(`ticket:${member.user.id}:${ticketNumber}`, '.state', serialize<string>('PENDING_REDO'));

        // Log ticket redo
        logger.debug(`TICKET:${ticketNumber}`, 'REDO');

        // Let the member know
        await member?.send(new MessageEmbed({
            color: colours.RED,
            author: {
                name: `🚀 Verification denied for ${reaction.message.guild!.name}!`
            },
            description: 'Don\'t worry though as you\'re able to redo it. Just reply with "!start" and we\'ll try again.',
            footer: {
                text: `Ticket #${ticketNumber}`
            }
        })).catch(error => {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`, 'MEMBER_LEFT');
        });
    },
    // Deny ticket in queue
    async '👎'(reaction: MessageReaction, member: GuildMember) {
        // Get ticket number
        const ticketNumber = parseInt(reaction.message.embeds[0].footer?.text?.match(/Ticket \#([0-9]+)/)![1]!, 10);

        // Ensure the user can't apply again
        await updateTicket(`ticket:${member.user.id}:${ticketNumber}`, '.state', serialize<string>('DENIED'));

        // Log ticket denied
        logger.debug(`TICKET:${ticketNumber}`, 'DENIED');

        try {
            // Let the member know
            await member?.send(new MessageEmbed({
                author: {
                    name: `🚀 Verification denied for ${reaction.message.guild!.name}!`
                },
                description: 'Your verification was denied!',
                footer: {
                    text: `Ticket #${ticketNumber}`
                }
            }));

            // Wait 1s
            await sleep(1000);

            // Kick the member
            await member?.kick();
        } catch {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`, 'MEMBER_LEFT');
        }
    }
};
