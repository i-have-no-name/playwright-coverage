import { joinRoom, leaveRoom, sendMessage, setStatus } from '../store/actions';
import { useAppDispatch, useAppSelector } from '../store/store';
import { announce } from '../store/thunks';

export function Footer() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.status);
  const room = useAppSelector((state) => state.room);

  const handleQuickReply = () => {
    if (!room) {
      return;
    }
    dispatch(sendMessage('ok'));
  };

  const toggleBusy = () => {
    dispatch(setStatus(status === 'busy' ? 'online' : 'busy'));
  };

  return (
    <footer>
      <button onClick={handleQuickReply}>Quick OK</button>
      <button onClick={toggleBusy}>Do not disturb</button>
      <button onClick={() => dispatch(leaveRoom())}>Leave room</button>
      <button onClick={() => dispatch(joinRoom('lobby'))}>Rejoin lobby</button>
      <button onClick={() => dispatch(announce('hello everyone'))}>Announce</button>
    </footer>
  );
}
