import { GuildMember } from 'discord.js';
import { store } from '../store';

export const onGuildMemberAdd = async function onGuildMemberAdd(member: GuildMember) {
    // To compare, we need to load the current invite list.
    const guildInvites = await member.guild.fetchInvites();
    // This is the *existing* invites for the guild.
    const existingInvite = store.invites.get(member.guild.id);
    // Update the cached invites for the guild.
    store.invites.set(member.guild.id, guildInvites);
    // Look through the invites, find the one for which the uses went up.
    const invite = guildInvites.find(invite => existingInvite.get(invite.code).uses < parseInt(String(invite.uses || 0), 10));

    // Update the members store with invite details
    store.members.set(`${member.guild.id}_${member.id}`, invite?.inviter?.id, 'invitedBy');
    store.members.set(`${member.guild.id}_${member.id}`, invite?.code, 'invite');
};
