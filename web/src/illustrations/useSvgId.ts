import { useId } from 'react';

/** useId() output may contain characters that break url(#id) references. */
export const useSvgId = () => `illo${useId().replace(/[^\w-]/g, '')}`;
