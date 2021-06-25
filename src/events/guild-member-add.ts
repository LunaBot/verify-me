import { GuildMember } from "discord.js";
import { startVerification } from "../utils/start-verification";

export const onGuildMemberAdd = async function onGuildMemberAdd(member: GuildMember) {
    // Start verification
    // return startVerification(member);
};