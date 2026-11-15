import { ChatPanel } from './components/ChatPanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Reactions } from './components/Reactions';
import { Sidebar } from './components/Sidebar';
import { useShortcuts } from './hooks/useShortcuts';

export function App() {
  useShortcuts();

  return (
    <>
      <Header />
      <Sidebar />
      <ChatPanel />
      <Reactions />
      <Footer />
    </>
  );
}
