import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export const reactionsSlice = createSlice({
  name: 'reactions',
  initialState: { last: null as string | null },
  reducers: {
    added: (state, action: PayloadAction<string>) => {
      state.last = action.payload;
    },
    cleared: (state) => {
      state.last = null;
    },
  },
});

export const { added: reactionAdded, cleared: reactionsCleared } = reactionsSlice.actions;
