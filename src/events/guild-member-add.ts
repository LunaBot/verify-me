import { GuildMember } from "discord.js";
import { store } from "../store";
import { startVerification } from "utils/start-verification";

export const onGuildMemberAdd = async function onGuildMemberAdd(member: GuildMember) {
    // Reset bot incase it's stuck
    store.members.delete(member.id, 'waiting-reply');

    // Start verification
    return startVerification(member);
};