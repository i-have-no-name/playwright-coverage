import { leaveRoom, refresh, setStatus, type Status } from '../store/actions';
import { useAppDispatch, useAppSelector } from '../store/store';
import { switchRoom } from '../store/thunks';

function SubHeader(props: any) {
  return (
    <div>
      <h1>SubHeader</h1>
      <button
        onClick={() => {
          props.onClick();
        }}
      >
        handle click
      </button>

      <button
        onClick={() => {
          props.onClick();
        }}
      >
        handle click
      </button>
    </div>
  );
}

export function Header() {
  const dispatch = useAppDispatch();
  const connected = useAppSelector((state) => state.connected);
  const room = useAppSelector((state) => state.room);
  const status = useAppSelector((state) => state.status);

  const handleLeave = () => {
    if (!room) {
      return;
    }
    dispatch(leaveRoom());
  };

  return (
    <header>
      <strong>{connected ? 'connected' : 'connecting'}</strong>
      <span> room: {room ?? 'none'}</span>
      <span> status: {status} </span>
      <select
        aria-label="Status"
        value={status}
        onChange={(event) => dispatch(setStatus(event.target.value as Status))}
      >
        <option>online</option>
        <option>away</option>
        <option>busy</option>
      </select>
      <button onClick={() => dispatch(refresh())}>Refresh</button>
      <button onClick={handleLeave}>Leave</button>
      <button onClick={() => dispatch(switchRoom('support'))}>Go to support</button>

      <SubHeader
        onClick={() => {
          dispatch(refresh());
        }}
      />
    </header>
  );
}
