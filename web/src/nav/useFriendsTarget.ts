import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/**
 * The group the «Друзья» entry opens straight away: the learner's only group, or null when there
 * are none or several (then the list of groups is shown). Secondary: a failed request means null.
 * `version` changes when the groups may have changed.
 */
export function useFriendsTarget(version: number): string | null {
  const [groupId, setGroupId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.groups().then(
      (groups) => live && setGroupId(groups.length === 1 ? groups[0].id : null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [version]);
  return groupId;
}
