import { promisify } from 'util';
import { redis as redisLib } from './redis';

export const redis = redisLib.createClient();

// Interval services
// Micro services will use this to communicate
export interface Service {};

// Discord guilds
export interface Guild {
    guildId: string;
    prefix: string;
    adminRole: string;
    sellersAllowed: boolean;
    announcementChannel: string;
    auditLogChannel: string;
    queueChannel: string;
    verificationMessage: string;
    ticketNumber: number;
    padding: number;
    roles: [];
    ageRoles: Record<string, string>;
    dmRoles: Record<string, string>;
    memberRole: string;
    sellerRole: string;
    welcomeRole: string;
};
export const defaultGuild: Partial<Guild> = {
    prefix: '!',
    ticketNumber: 0,
    padding: 5,
    roles: [],
    ageRoles: {},
    dmRoles: {}
};

// Discord users
export interface User {
    userId: string;
};
export const defaultUser: Partial<User> = {

};

// Tickets
export type TicketType = 'VERIFICATION' | 'BAN_APPEAL';
export type TicketState = 'OPEN' | 'PENDING' | 'PENDING_REDO' | 'CLOSED' | 'VERIFIED' | 'DENIED';
export interface Ticket {
    type: TicketType;
    ticketId: number;
    userId: string;
    state: TicketState;
};

declare module 'util' {
    // Custom promisify must exist or promisifying functions with overloads will break
    export function promisify<TCustom extends Function>(fn: CustomPromisify<TCustom>): TCustom;
    export function promisify<T extends (...args: any[]) => any>(fn: T): Promisify<T>;

    /**
     * Returns a promisified function signature for the given callback-style function.
     */
    type Promisify<
        T extends (...args: any[]) => any,
        TReturn = CallbackAPIReturnType<T>,
        TArgs extends any[] = Lead<Parameters<T>>
    > = [(...args: TArgs) => Promise<TReturn>][0]; // By indexing into the tuple, we force TypeScript to resolve the return type

    // Helper types for smart promisify signature
    /**
     * Returns the last item's type in a tuple
     */
    type Last<T extends unknown[]> = T extends []
        ? never
        : T extends [...infer _, infer R]
        ? R
        : T extends [...infer _, (infer R)?]
        ? R | undefined
        : never;

    /** Returns the type of the last argument of a function */
    type LastArgument<T extends (...args: any[]) => any> = Last<Parameters<T>>;

    /** Returns the "return" type of a callback-style API */
    type CallbackAPIReturnType<
        T extends (...args: any[]) => any,
        TCb extends (...args: any[]) => any = LastArgument<T>,
        TCbArgs = Parameters<Exclude<TCb, undefined>>
    > = TCbArgs extends [(Error | null | undefined)?]
        // tslint:disable-next-line void-return This is a return type
        ? void
        : TCbArgs extends [Error | null | undefined, infer U]
        ? U
        : TCbArgs extends any[]
        ? TCbArgs[1]
        : never;

    /**
     * Returns all but the last item's type in a tuple/array
     */
    type Lead<T extends unknown[]> = T extends [] ? [] : T extends [...infer L, any?] ? L : [];
}

export const serialize = <T>(object: T): string => JSON.stringify(object);
export const deserialize = <T>(string: string): T => JSON.parse(string) as T;

export const deserializeUser = (string: string) => deserialize<User>(string);
export const deserializeGuild = (string: string) => deserialize<Guild>(string);
export const deserializeTicket = (string: string) => deserialize<Ticket>(string);

export const getUser = promisify(redis.json_get).bind(redis);
export const updateUser = promisify(redis.json_set).bind(redis);
export const getGuild = promisify(redis.json_get).bind(redis);
export const updateGuild = promisify(redis.json_set).bind(redis);
export const increaseGuild = promisify(redis.json_numincrby).bind(redis);
export const getTicket = promisify(redis.json_get).bind(redis);
export const getTicketStatus = promisify(redis.json_get).bind(redis);
export const updateTicketStatus = promisify(redis.json_set).bind(redis);
export const getTicketKeys = promisify(redis.keys).bind(redis);
export const updateTicket = promisify(redis.json_set).bind(redis);
