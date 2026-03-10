import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';
import { GoogleGenAI, Type } from '@google/genai';
import { jsPDF } from 'jspdf';
import Markdown from 'react-markdown';
import { 
  Menu, X, Calendar as CalendarIcon, Inbox, CheckCircle, Circle, 
  Clock, Paperclip, Mic, Sparkles, Plus, Trash2, 
  RefreshCw, FileText, Copy, Download, Mail, AlertCircle, Check,
  ChevronDown, ChevronUp, Play, Square, Upload, Users, Phone, StopCircle,
  Camera, Image as ImageIcon, MapPin, Settings
} from 'lucide-react';

// --- Types ---
type SubtaskTodo = {
  id: string;
  title: string;
  isDone: boolean;
};

type Subtask = {
  id: string;
  title: string;
  isDone: boolean;
  notes: string;
  todos?: SubtaskTodo[];
};

type Task = {
  id: string;
  title: string;
  dueDate: string;
  time: string;
  followUpDate?: string;
  isDone: boolean;
  notes: string;
  subtasks: Subtask[];
  attachedFiles?: { name: string; type: string; data: string }[];
  attachedFile?: { name: string; type: string; data: string };
  phoneNumber?: string;
  whatsappNumber?: string;
  email?: string;
  deadline?: string;
  sachbearbeiter?: string;
  meetingResults?: string;
  handwrittenNotes?: string;
  location?: string;
  notifyOnArrival?: boolean;
  syncStatus: 'synced' | 'pending' | 'error' | 'local';
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  googleTaskId?: string;
  googleCalendarEventId?: string;
  createdAt: number;
};

type ToastMessage = {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
};

// --- Environment & Config ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GOOGLE_CLIENT_ID = localStorage.getItem('taskflow_google_client_id') || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_API_KEY = localStorage.getItem('taskflow_google_api_key') || import.meta.env.VITE_GOOGLE_API_KEY || '';
const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "dummy",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dummy",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dummy",
};

// --- Firebase Init ---
let app, auth: any, db: any;
try {
  app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase init failed", e);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const generateId = () => Math.random().toString(36).substring(2, 15);
const getTodayString = () => new Date().toISOString().split('T')[0];

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'today' | 'week' | 'month' | 'all' | 'archive' | 'calendar'>('all');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [aiAutoPilot, setAiAutoPilot] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [user, setUser] = useState<User | null>(null);
  
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [gmailMessages, setGmailMessages] = useState<any[]>([]);
  const [showGmailModal, setShowGmailModal] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDate, setNewTaskDate] = useState(getTodayString());
  const [newTaskTime, setNewTaskTime] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [isListeningGlobal, setIsListeningGlobal] = useState(false);
  const [generatedDocument, setGeneratedDocument] = useState<{title: string, content: string} | null>(null);
  const [newTaskLocation, setNewTaskLocation] = useState('');
  const [newTaskRecurrence, setNewTaskRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [taskType, setTaskType] = useState<'simple' | 'deadline'>('deadline');
  const [isDragging, setIsDragging] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncCodeInput, setSyncCodeInput] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailContent, setEmailContent] = useState('');
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempGoogleApiKey, setTempGoogleApiKey] = useState(GOOGLE_API_KEY);
  const [tempGoogleClientId, setTempGoogleClientId] = useState(GOOGLE_CLIENT_ID);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);

  const gapiLoaded = useRef(false);
  const gisLoaded = useRef(false);
  const tokenClient = useRef<any>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  // --- NEU: Hilfsfunktion um die "Aufgaben Gerd" Listen-ID zu finden ---
  const getGerdListId = async () => {
    try {
      const response = await window.gapi.client.tasks.tasklists.list();
      const lists = response.result.items || [];
      const gerdList = lists.find((l: any) => l.title === "Aufgaben Gerd");
      return gerdList ? gerdList.id : '@default';
    } catch (e) {
      console.error("Fehler beim Suchen der Taskliste", e);
      return '@default';
    }
  };

  useEffect(() => {
    if (!auth || !db) return;
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        const syncUid = localStorage.getItem('taskflow_sync_uid') || u.uid;
        const tasksRef = collection(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`);
        const q = query(tasksRef);
        const unsubscribeDb = onSnapshot(q, (snapshot) => {
          const loadedTasks: Task[] = [];
          snapshot.forEach((doc) => loadedTasks.push({ id: doc.id, ...doc.data() } as Task));
          setTasks(loadedTasks.sort((a, b) => b.createdAt - a.createdAt));
        });
        return () => unsubscribeDb();
      } else {
        signInAnonymously(auth).catch(e => console.warn("Anon auth failed", e));
      }
    });
    return () => unsubscribeAuth();
  }, [addToast]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) return;
    const loadGapi = () => {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        window.gapi.load('client', async () => {
          await window.gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: [
              'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest',
              'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
              'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'
            ],
          });
          gapiLoaded.current = true;
          if (gisLoaded.current) setIsGoogleReady(true);
        });
      };
      document.body.appendChild(script);
    };
    const loadGis = () => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        tokenClient.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly',
          callback: (tokenResponse: any) => {
            if (tokenResponse.error) throw (tokenResponse);
            setIsGoogleLoggedIn(true);
            addToast('success', 'Bei Google angemeldet.');
            fetchGoogleData();
          },
        });
        gisLoaded.current = true;
        if (gapiLoaded.current) setIsGoogleReady(true);
      };
      document.body.appendChild(script);
    };
    loadGapi();
    loadGis();
  }, [addToast]);

  const handleGoogleLogin = () => {
    if (!isGoogleReady || !tokenClient.current) return;
    tokenClient.current.requestAccessToken({prompt: window.gapi.client.getToken() === null ? 'consent' : ''});
  };

  const fetchGoogleData = async () => {
    try {
      const calRes = await window.gapi.client.calendar.events.list({
        'calendarId': 'primary', 'timeMin': (new Date()).toISOString(), 'showDeleted': false, 'singleEvents': true, 'maxResults': 10, 'orderBy': 'startTime'
      });
      setGoogleEvents(calRes.result.items || []);
    } catch (e) { console.error("Error fetching Google data", e); }
  };

  const syncTimeoutRef = useRef<{ [key: string]: any }>({});

  const saveTask = async (task: Task) => {
    setTasks(prev => {
      const exists = prev.find(t => t.id === task.id);
      if (exists) return prev.map(t => t.id === task.id ? task : t);
      return [task, ...prev];
    });

    if (user && db) {
      const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
      await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
    }

    if (isGoogleLoggedIn && window.gapi) {
      if (syncTimeoutRef.current[task.id]) clearTimeout(syncTimeoutRef.current[task.id]);
      syncTimeoutRef.current[task.id] = setTimeout(async () => {
        try {
          const listId = await getGerdListId();
          const taskResource = {
            title: task.title,
            notes: task.notes,
            status: task.isDone ? 'completed' : 'needsAction',
            due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined
          };

          if (task.googleTaskId) {
            await window.gapi.client.tasks.tasks.update({
              tasklist: listId, task: task.googleTaskId, resource: { id: task.googleTaskId, ...taskResource }
            });
          } else {
            const res = await window.gapi.client.tasks.tasks.insert({ tasklist: listId, resource: taskResource });
            task.googleTaskId = res.result.id;
            if (user && db) {
                const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
                await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
            }
          }
        } catch (e) { console.error("Google Sync Error", e); }
      }, 2000);
    }
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    if (user && db) {
      const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
      await deleteDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, taskId));
    }
    if (isGoogleLoggedIn && window.gapi && task?.googleTaskId) {
      try {
        const listId = await getGerdListId();
        await window.gapi.client.tasks.tasks.delete({ tasklist: listId, task: task.googleTaskId });
      } catch (e) {}
    }
  };

  // --- UI Filter Logic ---
  const filteredTasks = tasks.filter(t => {
    if (filter === 'archive') return t.isDone;
    if (t.isDone) return false;
    if (filter === 'today') return t.dueDate === getTodayString();
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-800">
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-72 bg-white border-r border-slate-200 z-40 flex flex-col`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-600">
            <CheckCircle size={28} className="fill-current" />
            <h1 className="text-xl font-bold">Gerd Tasks</h1>
          </div>
        </div>
        <nav className="px-4 flex-1 space-y-1">
          <button onClick={() => setFilter('all')} className={`w-full flex items-center px-4 py-3 rounded-xl ${filter === 'all' ? 'bg-indigo-50 text-indigo-700' : ''}`}><Inbox className="mr-3"/> Alle</button>
          <button onClick={() => setFilter('today')} className={`w-full flex items-center px-4 py-3 rounded-xl ${filter === 'today' ? 'bg-indigo-50 text-indigo-700' : ''}`}><Clock className="mr-3"/> Heute</button>
          <button onClick={() => setFilter('archive')} className={`w-full flex items-center px-4 py-3 rounded-xl ${filter === 'archive' ? 'bg-indigo-50 text-indigo-700' : ''}`}><CheckCircle className="mr-3"/> Archiv</button>
          <button onClick={() => setShowSettingsModal(true)} className="w-full flex items-center px-4 py-3 rounded-xl text-slate-500 mt-10"><Settings className="mr-3"/> Einstellungen</button>
        </nav>
        {!isGoogleLoggedIn && (
            <div className="p-6"><button onClick={handleGoogleLogin} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold">Google Login</button></div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white p-4 rounded-[2rem] shadow-sm mb-8 flex gap-4">
            <input 
                type="text" 
                value={newTaskTitle} 
                onChange={e => setNewTaskTitle(e.target.value)} 
                placeholder="Neue Aufgabe für 'Aufgaben Gerd'..." 
                className="flex-1 border-none focus:ring-0 text-lg"
            />
            <button onClick={() => {
                const t: Task = { id: generateId(), title: newTaskTitle, dueDate: newTaskDate, time: '', isDone: false, notes: '', subtasks: [], syncStatus: 'local', createdAt: Date.now() };
                saveTask(t);
                setNewTaskTitle('');
            }} className="p-4 bg-indigo-600 text-white rounded-full"><Plus/></button>
          </div>

          <div className="space-y-4">
            {filteredTasks.map(t => (
              <div key={t.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center gap-4">
                <button onClick={() => saveTask({...t, isDone: !t.isDone})}>
                    {t.isDone ? <CheckCircle className="text-emerald-500" size={28}/> : <Circle className="text-slate-300" size={28}/>}
                </button>
                <div className="flex-1">
                    <h3 className={`font-bold ${t.isDone ? 'line-through text-slate-400' : ''}`}>{t.title}</h3>
                    {t.dueDate && <span className="text-xs text-slate-400">{t.dueDate}</span>}
                </div>
                <button onClick={() => deleteTask(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={20}/></button>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-3xl w-full max-w-md">
                  <h2 className="text-2xl font-bold mb-6">Setup</h2>
                  <div className="space-y-4">
                    <input type="text" value={tempGoogleClientId} onChange={e => setTempGoogleClientId(e.target.value)} placeholder="Google Client ID" className="w-full p-3 bg-slate-100 rounded-xl border-none"/>
                    <input type="password" value={tempGoogleApiKey} onChange={e => setTempGoogleApiKey(e.target.value)} placeholder="Google API Key" className="w-full p-3 bg-slate-100 rounded-xl border-none"/>
                    <div className="flex gap-2 mt-6">
                        <button onClick={() => setShowSettingsModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl">Abbrechen</button>
                        <button onClick={() => {
                            localStorage.setItem('taskflow_google_client_id', tempGoogleClientId);
                            localStorage.setItem('taskflow_google_api_key', tempGoogleApiKey);
                            window.location.reload();
                        }} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Speichern</button>
                    </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
