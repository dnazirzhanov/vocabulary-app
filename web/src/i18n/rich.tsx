import { Fragment, type ReactNode } from 'react';

/** A message with markup in it: `rich('{0} из 5', <strong>3</strong>)`. */
export function rich(message: string, ...nodes: ReactNode[]): ReactNode {
  const parts = message.split(/\{(\d)\}/);
  return parts.map((part, index) => <Fragment key={index}>{index % 2 === 1 ? nodes[Number(part)] : part}</Fragment>);
}
