import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import { commandAcked, socketOpened } from './actions';
import { actionToCommand } from './commands';

export const socketMiddleware: Middleware = (store) => {
  const socket = new WebSocket('ws://localhost:8787');

  socket.onopen = () => {
    store.dispatch(socketOpened());
  };
  socket.onmessage = (event) => {
    store.dispatch(commandAcked(JSON.parse(event.data).payload.of));
  };

  return (next) => (action) => {
    const result = next(action);
    const command = actionToCommand(action as UnknownAction);
    if (command && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
    return result;
  };
};
