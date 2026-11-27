import { useEffect, useRef, useState } from 'react';
import { createPlayer, type VideoPlayer, type VideoProblem } from './player.ts';

/**
 * YouTube's player in the element `ref` points at. YouTube replaces the element it is given with
 * its iframe, so it gets a child of ours, never React's own node.
 */
export function useYouTube(videoId: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [problem, setProblem] = useState<VideoProblem | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host || !videoId) return;
    const slot = document.createElement('div');
    host.appendChild(slot);
    setReady(false);
    setProblem(null);
    const made = createPlayer(slot, videoId, {
      onReady: () => setReady(true),
      onPlayingChange: setPlaying,
      onProblem: setProblem,
    });
    setPlayer(made);
    return () => {
      made.destroy();
      host.replaceChildren();
      setPlayer(null);
    };
  }, [videoId]);

  return { ref, player: ready ? player : null, playing, problem };
}
