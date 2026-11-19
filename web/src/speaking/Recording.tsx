/**
 * A past recording: looks like the player from the start, and loads the audio only when the learner
 * taps play (an archive of many answers must not download them all).
 */
import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { AudioPlayer, PlayIcon } from '../shadowing/AudioPlayer.tsx';
import { clock } from '../shadowing/oneAtATime.ts';
import player from '../shadowing/AudioPlayer.module.css';
import { recordingUrl } from './api.ts';

interface Props {
  sessionId: string;
  durationMs: number | null;
  label: string;
}

export function Recording({ sessionId, durationMs, label }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (url) return <AudioPlayer src={url} label={label} knownDurationMs={durationMs ?? undefined} autoPlay />;

  const load = async () => {
    setState('loading');
    try {
      setUrl(await recordingUrl(sessionId));
    } catch {
      setState('failed');
    }
  };

  return (
    <div className={player.player}>
      <button
        type="button"
        className={player.play}
        onClick={() => void load()}
        disabled={state === 'loading'}
        aria-label={`${t.speakingPlay}: ${label}`}
      >
        <PlayIcon />
      </button>
      <div className={player.body}>
        <span className={player.label}>{state === 'failed' ? t.speakingRecordingFailed : label}</span>
      </div>
      <span className={player.time}>{durationMs ? clock(durationMs / 1000) : ''}</span>
    </div>
  );
}
