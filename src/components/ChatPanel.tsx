import { useEffect, useState, type FormEvent } from 'react';
import { joinRoom, refresh, sendMessage } from '../store/actions';
import { useAppDispatch, useAppSelector } from '../store/store';

export function ChatPanel() {
  const dispatch = useAppDispatch();
  const room = useAppSelector((state) => state.room);
  const messages = useAppSelector((state) => state.messages);
  const acks = useAppSelector((state) => state.acks);
  const [text, setText] = useState('');

  useEffect(() => {
    if (room) {
      dispatch(refresh());
    }
  }, [dispatch, room]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    dispatch(sendMessage(text));
    setText('');
  };

  return (
    <main>
      {room ? (
        <form onSubmit={handleSubmit}>
          <input aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} />
          <button>Send</button>
        </form>
      ) : (
        <button onClick={() => dispatch(joinRoom('lobby'))}>Join lobby</button>
      )}
      <ul aria-label="Messages">
        {messages.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
      <ol aria-label="Server acks">
        {acks.map((ack, index) => (
          <li key={index}>{ack}</li>
        ))}
      </ol>
    </main>
  );
}
