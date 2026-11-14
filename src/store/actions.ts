import { createAction } from '@reduxjs/toolkit';

export type Status = 'online' | 'away' | 'busy';

export const sendMessage = createAction<string>('sendMessage');
export const joinRoom = createAction<string>('joinRoom');
export const leaveRoom = createAction('leaveRoom');
export const setStatus = createAction<Status>('setStatus');
export const refresh = createAction('refresh');

export const socketOpened = createAction('socketOpened');
export const commandAcked = createAction<string>('commandAcked');
