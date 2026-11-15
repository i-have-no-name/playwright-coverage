import { useCallback } from 'react';
import { reactionAdded } from '../store/reactions';
import { useAppDispatch } from '../store/store';

export function useReactions() {
  const dispatch = useAppDispatch();
  const react = useCallback((emoji: string) => dispatch(reactionAdded(emoji)), [dispatch]);
  return { react };
}
