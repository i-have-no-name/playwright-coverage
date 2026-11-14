import { joinRoom, leaveRoom, refresh, sendMessage, setStatus } from '../store/actions';
import { useAppDispatch, useAppSelector } from '../store/store';

const ROOMS = ['lobby', 'support', 'random'];

export function Sidebar() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.status);

  const toggleAway = () => {
    dispatch(setStatus(status === 'away' ? 'online' : 'away'));
  };

  return (
    <aside>
      <h2>Rooms</h2>
      {ROOMS.map((room) => (
        <button key={room} onClick={() => dispatch(joinRoom(room))}>
          {room}
        </button>
      ))}
      <button onClick={() => dispatch(refresh())}>Refresh rooms</button>
      <button onClick={toggleAway}>Toggle away</button>
      <button onClick={() => dispatch(leaveRoom())}>Leave</button>
      <button onClick={() => dispatch(sendMessage('wave'))}>Wave</button>
    </aside>
  );
}
