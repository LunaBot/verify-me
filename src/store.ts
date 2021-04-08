import EnhancedMap from 'enmap';

type TicketState = 'open' | 'pending' | 'pending redo' | 'closed' | 'verified' | 'denied';
const tickets = new EnhancedMap({
    name: 'tickets',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep',
    // @ts-expect-error
    autoEnsure: {
        /** @type {TicketState} */
        state: null,
        /** @type {string} */
        member: null,
        /** @type {number} */
        step: null
    }
});

const watchedMessages = new EnhancedMap({
    name: 'watched-messages',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep'
});

export const guildsDefaultOptions = {
    prefix: '!',
    adminRole: 'Admin',
    announcementChannel: null,
    auditLogChannel: null,
    queueChannel: null,
    verificationMessage: null,
    ticketNumber: 0,
    padding: 5,
    roles: []
};
const guilds = new EnhancedMap({
    name: 'guilds',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep',
    // @ts-expect-error
    autoEnsure: guildsDefaultOptions
});

const members = new EnhancedMap({
    name: 'members',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep',
    // @ts-expect-error
    autoEnsure: {
        state: null,
        invitedBy: null,
        inviteCode: null
    }
});

const invites = new EnhancedMap({
    name: 'invites',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep'
});

export const store = {
    tickets,
    watchedMessages,
    guilds,
    members,
    invites
};
