import { delay, put, takeLatest } from 'redux-saga/effects';
import { reactionsSlice } from './reactions';

function* clearReactionLater() {
  yield delay(500);
  yield put(reactionsSlice.actions.cleared());
}

export function* rootSaga() {
  yield takeLatest(reactionsSlice.actions.added.type, clearReactionLater);
}
