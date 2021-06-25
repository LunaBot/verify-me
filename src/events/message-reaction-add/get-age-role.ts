import { deserializeGuild, getGuild } from "../../store";


export const getAgeRole = async (guildId: string, age: number) => {
    const guild = await getGuild(guildId, '.').then(deserializeGuild);
    const ageRoles = guild.ageRoles;

    if (age < 18) return;
    if (age < 31) return ageRoles['18-30'];
    if (age < 41) return ageRoles['31-40'];
    if (age < 61) return ageRoles['41-60'];
    if (age < 99) return ageRoles['61-99'];
    return;
};
