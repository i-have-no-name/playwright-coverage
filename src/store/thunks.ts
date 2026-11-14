import { joinRoom, leaveRoom, refresh, sendMessage, setStatus } from './actions';
import type { AppThunk } from './store';

export const switchRoom =
  (room: string): AppThunk =>
  (dispatch, getState) => {
    if (getState().room) {
      dispatch(leaveRoom());
    }
    dispatch(joinRoom(room));
    dispatch(refresh());
  };

export const announce =
  (text: string): AppThunk =>
  (dispatch) => {
    dispatch(setStatus('online'));
    dispatch(sendMessage(text));
  };
