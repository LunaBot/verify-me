import { GuildMember } from "discord.js";
import { store } from "../store";

export const onGuildMemberRemove = async function onGuildMemberRemove(member: GuildMember) {
    // Don't delete ticket if the user was denied
    if (store.members.get(`${member.guild.id}_${member.id}`, 'state') === 'DENIED') return;

    // Delete open ticket
    store.members.delete(`${member.guild.id}_${member.id}`);
};
