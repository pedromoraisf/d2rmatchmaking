// The player's room (LBR-12), the prototype's room panel inside the shell: the stage stepper, the game name to create with
// "No password" and a copy button, what the host and the members do, the members with the agents' confirmation, the run
// history, and Leave room / Next run / Close room for whom they apply. Presence is only ever what an agent confirmed:
// there is no button to confirm anyone (the Design Doc has no manual confirmation).
import { useRef, useState } from 'react';
import type { CharacterClass, RoomView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient, ApiResult } from '../../shared/api-client.ts';
import { classKey, stageKey } from '../../shared/labels.ts';
import { tracedAction } from '../../shared/telemetry.ts';
import './room.css';

type Stage = RoomView['stage'];

/** A member of the room as the panel shows it: the match's member, the agent's confirmation and the character's marks. */
export interface RoomMemberShown {
  accountId: string;
  joinOrder: number;
  role: 'host' | 'member';
  confirmed: boolean;
  class: CharacterClass | null;
  level: number | null;
}

export interface RoomShown {
  roomId: string;
  gameName: string;
  stage: Stage;
  run: number;
  members: RoomMemberShown[];
  /** The run history, oldest first, the current run last. */
  runs: { run: number; gameName: string }[];
}

/** The stages of the stepper, in order (FR-15). `closed` and `expired` end the room and are not steps. */
export const STEPPER_STAGES: readonly Stage[] = ['formed', 'awaiting_host', 'created', 'active'];

/** The stage a stepper step stands for is current: the room is in it. */
export function isCurrentStep(step: Stage, stage: Stage): boolean {
  return step === stage;
}

export interface RoomPanelProps {
  room: RoomShown;
  /** The reader's own account id. */
  you: string;
  client: ApiClient;
  /** Called after an action went through, so the site reads its room again. */
  onActed: () => void;
}

function isOpen(stage: Stage): boolean {
  return stage !== 'closed' && stage !== 'expired';
}

export function RoomPanel({ room, you, client, onActed }: RoomPanelProps) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [failed, setFailed] = useState(false);
  const nameRef = useRef<HTMLElement | null>(null);

  const open = isOpen(room.stage);
  const isHost = room.members.some((member) => member.accountId === you && member.role === 'host');

  async function copyName() {
    try {
      await navigator.clipboard.writeText(room.gameName);
      setCopy('copied');
    } catch {
      // No Clipboard API or no permission: the name is selected, so the player can press Ctrl+C.
      const name = nameRef.current;
      if (name !== null) {
        const range = document.createRange();
        range.selectNodeContents(name);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopy('failed');
    }
  }

  async function act(name: string, run: () => Promise<ApiResult<void>>) {
    const result = await tracedAction(name, run);
    if (result.ok) {
      setFailed(false);
      onActed();
    } else {
      setFailed(true);
    }
  }

  return (
    <section className="panel room-panel" aria-labelledby="room-heading">
      <div className="room-h">
        <h2 id="room-heading">{t('room.heading')}</h2>
      </div>

      <ol className="stepper" aria-label={t('room.stagesLabel')}>
        {STEPPER_STAGES.map((step) => (
          <li
            key={step}
            className={isCurrentStep(step, room.stage) ? 'step now' : 'step'}
            aria-current={isCurrentStep(step, room.stage) ? 'step' : undefined}
          >
            {t(stageKey(step))}
          </li>
        ))}
      </ol>

      {open ? null : (
        <p role="status" className="ended">
          {t(room.stage === 'closed' ? 'room.ended.closed' : 'room.ended.expired')}
        </p>
      )}

      <div className="cred">
        <span className="muted">{t('room.gameName')}</span>
        <code className="credential" ref={nameRef}>
          {room.gameName}
        </code>
        <span className="nopass">{t('room.noPassword')}</span>
        <button type="button" className="btn quiet" onClick={() => void copyName()}>
          {t('room.copy')}
        </button>
        {copy === 'copied' ? <span role="status">{t('room.copied')}</span> : null}
        {copy === 'failed' ? <span role="alert">{t('room.copyFailed')}</span> : null}
      </div>

      {open ? (
        <ol className="steps" aria-label={t('room.stepsLabel')}>
          {isHost ? (
            <>
              <li>{t('room.steps.hostCreate', { name: room.gameName })}</li>
              <li>{t('room.steps.hostParty')}</li>
            </>
          ) : (
            <>
              <li>{t('room.steps.memberWait', { name: room.gameName })}</li>
              <li>{t('room.steps.memberJoin')}</li>
              <li>{t('room.steps.memberParty')}</li>
            </>
          )}
          <li>{t('room.steps.expiry')}</li>
        </ol>
      ) : null}

      <h3>{t('room.membersLabel')}</h3>
      <ul className="players" aria-label={t('room.membersLabel')}>
        {room.members.map((member) => (
          <li key={member.accountId} className="pl">
            <span className="pos">{member.joinOrder}</span>
            <span className="who">
              {member.class !== null && member.level !== null
                ? t('room.classLevel', { characterClass: t(classKey(member.class)), level: member.level })
                : t('room.unknownCharacter')}
            </span>
            {member.role === 'host' ? <span className="tag hostmark">{t('room.host')}</span> : null}
            {member.accountId === you ? <span className="tag">{t('room.you')}</span> : null}
            <span className={member.confirmed ? 'pres ok' : 'pres wait'}>
              {t(member.confirmed ? 'room.presence.confirmed' : 'room.presence.waiting')}
            </span>
          </li>
        ))}
      </ul>

      <h3>{t('room.runsLabel')}</h3>
      <ol className="runlog" aria-label={t('room.runsLabel')}>
        {room.runs.map((run) => (
          <li key={run.run} aria-current={run.run === room.run ? 'true' : undefined}>
            {`${t('room.run', { run: run.run })}: ${run.gameName}`}
            {run.run === room.run ? ` (${t('room.runCurrent')})` : null}
          </li>
        ))}
      </ol>

      {open ? (
        <div className="actions">
          {isHost && room.stage === 'active' ? (
            <button
              type="button"
              className="btn-blood"
              onClick={() => void act('web.action.next-run', () => client.openNextRun(room.roomId))}
            >
              {t('room.nextRun')}
            </button>
          ) : null}
          {isHost ? (
            <button
              type="button"
              className="btn bad"
              onClick={() => void act('web.action.close-room', () => client.closeRoom(room.roomId))}
            >
              {t('room.close')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => void act('web.action.leave-room', () => client.leaveRoom(room.roomId))}
          >
            {t('room.leave')}
          </button>
        </div>
      ) : null}
      {failed ? <p role="alert">{t('room.actionFailed')}</p> : null}
    </section>
  );
}
