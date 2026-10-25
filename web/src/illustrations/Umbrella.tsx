const drop = (x: number, y: number) =>
  `M${x} ${y - 9} C${x + 6} ${y - 1} ${x + 6} ${y + 6} ${x} ${y + 6} C${x - 6} ${y + 6} ${x - 6} ${y - 1} ${x} ${y - 9} Z`;

const drops = [
  [50, 46],
  [86, 18],
  [158, 14],
  [196, 44],
];

export function Umbrella() {
  return (
    <>
      <ellipse cx="120" cy="214" rx="44" ry="6" fill="var(--illo-shadow)" stroke="none" />
      {drops.map(([x, y]) => (
        <path key={`${x}-${y}`} d={drop(x, y)} fill="var(--illo-sky)" strokeWidth={3.5} />
      ))}
      <path d="M120 122 V192 a10 10 0 0 1 -20 0" fill="none" strokeWidth={6} />
      <path d="M120 42 V30" strokeWidth={6} />
      <path
        d="M40 122 A80 80 0 0 1 200 122 A20 14 0 0 0 160 122 A20 14 0 0 0 120 122 A20 14 0 0 0 80 122 A20 14 0 0 0 40 122 Z"
        fill="var(--illo-accent)"
      />
      <path d="M120 42 Q90 66 80 122 A20 14 0 0 1 120 122 Z" fill="var(--illo-peach)" />
      <path d="M120 42 A80 80 0 0 1 200 122 A20 14 0 0 0 160 122 Q150 66 120 42 Z" fill="var(--illo-peach)" />
      <path d="M56 98 Q62 76 78 62" fill="none" stroke="var(--illo-white)" />
    </>
  );
}
