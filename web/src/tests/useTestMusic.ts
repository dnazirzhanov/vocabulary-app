import { useCallback, useEffect, useRef, useState } from 'react';
import { Music, musicOn, setMusicOn } from '../lib/music.ts';

/**
 * The test's background music: plays while words are being answered (if the learner wants it),
 * speeds up when `urgent`, stops at the result, and holds still while the app is in the background.
 */
export function useTestMusic(playing: boolean, urgent: boolean): [boolean, () => void] {
  const music = useRef<Music | null>(null);
  music.current ??= new Music();
  const [on, setOn] = useState(musicOn);

  useEffect(() => {
    const m = music.current!;
    if (on && playing) m.start();
    else m.stop();
  }, [on, playing]);

  useEffect(() => {
    music.current!.urgent = urgent;
  }, [urgent]);

  useEffect(() => {
    const m = music.current!;
    const visibility = () => (document.hidden ? m.pause() : m.resume());
    // After a reload the browser may hold sound back until the first tap.
    const tap = () => m.resume();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pointerdown', tap);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointerdown', tap);
      m.stop();
    };
  }, []);

  const toggle = useCallback(() => {
    setOn((was) => {
      setMusicOn(!was);
      return !was;
    });
  }, []);

  return [on, toggle];
}
