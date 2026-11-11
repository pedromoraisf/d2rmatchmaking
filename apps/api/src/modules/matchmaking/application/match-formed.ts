// The `MatchFormed` event of a group (QUE-12): members in join order, the host as `role: host`, and a 2v2 member's team.
// Written when every member has accepted its ready check (RDY-03); the room opens from it.
import type { FormedGroup } from '../domain/matcher.ts';
import type { MatchFormedEvent } from '../../../shared-kernel/index.ts';

/** The `MatchFormed` event of one group, with the match id the caller allocated. */
export function matchFormedEvent(group: FormedGroup, matchId: string): MatchFormedEvent {
  return {
    type: 'MatchFormed',
    payload: {
      matchId,
      mode: group.mode,
      activity: group.activity,
      difficulty: group.difficulty,
      region: group.region,
      ladder: group.ladder,
      era: group.era,
      members: group.members.map((member, index) => ({
        accountId: member.accountId,
        characterId: member.characterId,
        joinOrder: index + 1,
        role: member.id === group.hostTicketId ? 'host' : 'member',
        ...teamOfMember(group, member.id),
      })),
    },
  };
}

/** The team of a member of a 2v2 group, `a` or `b` from the snake draft; nothing for every other group. */
export function teamOfMember(group: FormedGroup, ticketId: string): { team?: 'a' | 'b' } {
  if (group.teams === null) {
    return {};
  }
  return group.teams[0].includes(ticketId) ? { team: 'a' } : { team: 'b' };
}
