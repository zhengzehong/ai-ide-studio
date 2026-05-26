import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import TaskBoard from './pages/TaskBoard';
import Schedule from './pages/Schedule';
import { useConnectionStore } from './stores/connection.store';
import { useAgentStore } from './stores/agent.store';
import { useSessionStore } from './stores/session.store';
import { useTaskStore } from './stores/task.store';
import { useRuleStore } from './stores/rule.store';

export default function App() {
  const init = useConnectionStore(s => s.init);
  const connected = useConnectionStore(s => s.connected);
  const listenersReady = useRef(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!connected) return;

    useAgentStore.getState().fetchAgents();
    useSessionStore.getState().fetchSessions();
    useTaskStore.getState().fetchTasks();
    useRuleStore.getState().fetchRules();

    if (!listenersReady.current) {
      listenersReady.current = true;
      const off1 = useAgentStore.getState().setupListeners();
      const off2 = useSessionStore.getState().setupListeners();
      const off3 = useTaskStore.getState().setupListeners();
      const off4 = useRuleStore.getState().setupListeners();
      return () => {
        off1(); off2(); off3(); off4();
        listenersReady.current = false;
      };
    }
  }, [connected]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/tasks" element={<TaskBoard />} />
          <Route path="/schedule" element={<Schedule />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
