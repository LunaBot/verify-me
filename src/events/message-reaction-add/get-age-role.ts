import { store } from "../../store";

export const getAgeRole = (guildId: string, age: number) => {
    const ageRoles = store.guilds.get(guildId, 'ageRoles');

    if (age < 18) return;
    if (age < 31) return ageRoles['18-30'];
    if (age < 41) return ageRoles['31-40'];
    if (age < 61) return ageRoles['41-60'];
    if (age < 99) return ageRoles['61-99'];
    return;
};
