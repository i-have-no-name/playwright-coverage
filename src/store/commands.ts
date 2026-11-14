import type { UnknownAction } from '@reduxjs/toolkit';
import { joinRoom, leaveRoom, refresh, sendMessage, setStatus } from './actions';

export type Command = { topic: string; payload: Record<string, unknown> };

export function actionToCommand(action: UnknownAction): Command | null {
  if (sendMessage.match(action)) {
    return {
      topic: 'message.send',
      payload: { text: action.payload.trim(), sentAt: Date.now() },
    };
  }

  if (joinRoom.match(action)) {
    return { topic: 'room.join', payload: { room: action.payload } };
  }

  if (leaveRoom.match(action)) {
    return { topic: 'room.leave', payload: {} };
  }

  if (setStatus.match(action)) {
    return { topic: 'presence.update', payload: { status: action.payload } };
  }

  if (refresh.match(action)) {
    return { topic: 'state.sync', payload: {} };
  }

  return null;
}
