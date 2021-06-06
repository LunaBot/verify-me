import { Role } from 'discord.js';

// https://github.com/microsoft/TypeScript/issues/20812#issuecomment-493622598
export const isRole = (role?: Role): role is Role => role !== undefined;
