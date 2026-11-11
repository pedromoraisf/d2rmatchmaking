// The player's room: the game name to create, "No password" and the stage (AWS-21, AWS-23). The newest room is shown.
import type { RoomView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { stageKey } from '../../shared/labels.ts';

export interface RoomShown {
  roomId: string;
  gameName: string;
  stage: RoomView['stage'];
}

export function RoomPanel({ room }: { room: RoomShown }) {
  const { t } = useTranslation();
  return (
    <section className="panel">
      <dl>
        <dt>{t('room.gameName')}</dt>
        <dd className="credential">{room.gameName}</dd>
        <dd>{t('room.noPassword')}</dd>
        <dt>{t('room.stage')}</dt>
        <dd>{t(stageKey(room.stage))}</dd>
      </dl>
    </section>
  );
}
