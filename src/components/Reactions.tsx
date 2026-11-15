import { bindActionCreators } from '@reduxjs/toolkit';
import { useMemo } from 'react';
import { useReactions } from '../hooks/useReactions';
import { reactionsSlice } from '../store/reactions';
import { useAppDispatch, useAppSelector } from '../store/store';

export function Reactions() {
  const dispatch = useAppDispatch();
  const last = useAppSelector((state) => state.reactions.last);
  const { react } = useReactions();
  const actions = useMemo(() => bindActionCreators(reactionsSlice.actions, dispatch), [dispatch]);

  return (
    <section aria-label="Reactions">
      <span>reaction: {last ?? 'none'}</span>
      <button onClick={() => react('thumbs-up')}>Thumbs up</button>
      <button onClick={() => react('party')}>Party</button>
      <button onClick={() => actions.cleared()}>Clear reaction</button>
    </section>
  );
}
