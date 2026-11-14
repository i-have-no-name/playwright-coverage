import { configureStore, createReducer, type ThunkAction, type UnknownAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import {
  commandAcked,
  joinRoom,
  leaveRoom,
  sendMessage,
  setStatus,
  socketOpened,
  type Status,
} from './actions';
import { socketMiddleware } from './socket';

const initialState = {
  connected: false,
  room: null as string | null,
  status: 'online' as Status,
  messages: [] as string[],
  acks: [] as string[],
};

const reducer = createReducer(initialState, (builder) => {
  builder
    .addCase(socketOpened, (state) => {
      state.connected = true;
    })
    .addCase(commandAcked, (state, action) => {
      state.acks.push(action.payload);
    })
    .addCase(joinRoom, (state, action) => {
      state.room = action.payload;
    })
    .addCase(leaveRoom, (state) => {
      state.room = null;
    })
    .addCase(setStatus, (state, action) => {
      state.status = action.payload;
    })
    .addCase(sendMessage, (state, action) => {
      state.messages.push(action.payload);
    });
});

export const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(socketMiddleware),
});

export type RootState = ReturnType<typeof reducer>;
export type AppDispatch = typeof store.dispatch;
export type AppThunk = ThunkAction<void, RootState, unknown, UnknownAction>;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
