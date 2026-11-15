import { useEffect } from 'react';
import { joinRoom, leaveRoom, refresh, sendMessage, setStatus } from '../store/actions';
import { useAppDispatch } from '../store/store';

export function useShortcuts() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') {
        return;
      }
      switch (event.key) {
        case 'r':
          dispatch(refresh());
          break;
        case 'Escape':
          dispatch(leaveRoom());
          break;
        case 'l':
          dispatch(joinRoom('lobby'));
          break;
        case 'a':
          dispatch(setStatus('away'));
          break;
        case 'h':
          dispatch(sendMessage('hi'));
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);
}
