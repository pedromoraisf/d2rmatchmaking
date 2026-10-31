// Maps contract values to translation keys, so the site never shows a raw enum (AWS-14, AWS-21, AWS-23).
import type { AgentPresenceChangedEvent, RoomView } from '@d2rmm/contracts';

type Stage = RoomView['stage'];
type Screen = AgentPresenceChangedEvent['data']['screen'];

export const stageKey = (stage: Stage): string => `room.stages.${stage}`;
export const screenKey = (screen: Screen): string => `presence.screen.${screen}`;
export const onlineKey = (online: boolean): string => (online ? 'presence.online' : 'presence.offline');
export const gameKey = (gameRunning: boolean): string =>
  gameRunning ? 'presence.gameOpen' : 'presence.gameClosed';
