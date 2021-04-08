import { GuildMember } from "discord.js";
import { sendAuditLogMessage } from "../utils";
import { store } from "../store";
import { logger } from "../logger";

export const onGuildMemberRemove = async function onGuildMemberRemove(member: GuildMember) {
    // Set message state to closed
    store.members.set(`${member.guild.id}_${member.id}`, 'closed', 'state');

    // Get current ticket number
    const ticketNumber: number = store.guilds.get(member.guild.id, 'ticketNumber');

    // Log member leaving
    logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'CLOSED', `${member.user.username}#${member.user.discriminator}`);

    // Post in audit-log
    await sendAuditLogMessage({
        colour: 'AQUA',
        guildId: member.guild.id,
        ticketNumber
    });
};
