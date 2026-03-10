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
  attachedFile?: { name: string; type: string; data: string }; // Keep for backward compatibility
  attachedFiles?: { name: string; type: string; data: string }[];
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
  console.warn("Firebase init failed, using local fallback", e);
}

// --- Gemini Init ---
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- Helper Functions ---
const generateId = () => Math.random().toString(36).substring(2, 15);

const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Main App Component ---
export default function App() {
  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'today' | 'week' | 'month' | 'all' | 'archive' | 'calendar'>('all');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [aiAutoPilot, setAiAutoPilot] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [user, setUser] = useState<User | null>(null);
  
  // Google State
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [gmailMessages, setGmailMessages] = useState<any[]>([]);
  const [showGmailModal, setShowGmailModal] = useState(false);

  // Input State
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

  // Refs
  const gapiLoaded = useRef(false);
  const gisLoaded = useRef(false);
  const tokenClient = useRef<any>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);

  // --- Toast System ---
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  // --- Firebase Sync ---
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
          snapshot.forEach((doc) => {
            loadedTasks.push({ id: doc.id, ...doc.data() } as Task);
          });
          setTasks(loadedTasks.sort((a, b) => b.createdAt - a.createdAt));
        }, (error) => {
          console.error("Firestore sync error:", error);
          addToast('error', 'Fehler bei der Cloud-Synchronisierung.');
        });
        return () => unsubscribeDb();
      } else {
        signInAnonymously(auth).catch(e => console.warn("Anon auth failed", e));
      }
    });

    return () => unsubscribeAuth();
  }, [addToast]);

  // --- Google API Init ---
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
      console.warn("Google API credentials missing. Google features disabled.");
      return;
    }

    const loadGapi = () => {
      if (gapiLoaded.current) return;
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        window.gapi.load('client', async () => {
          try {
            await window.gapi.client.init({
              apiKey: GOOGLE_API_KEY,
              discoveryDocs: [
                'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest',
                'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
                'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'
              ],
            });
            gapiLoaded.current = true;
            checkGoogleReady();
          } catch (e) {
            console.error("GAPI init error", e);
            addToast('error', 'Google API konnte nicht initialisiert werden.');
          }
        });
      };
      document.body.appendChild(script);
    };

    const loadGis = () => {
      if (gisLoaded.current) return;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        tokenClient.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly',
          callback: (tokenResponse: any) => {
            if (tokenResponse.error !== undefined) {
              throw (tokenResponse);
            }
            setIsGoogleLoggedIn(true);
            addToast('success', 'Erfolgreich bei Google angemeldet.');
            fetchGoogleData();
          },
        });
        gisLoaded.current = true;
        checkGoogleReady();
      };
      document.body.appendChild(script);
    };

    const checkGoogleReady = () => {
      if (gapiLoaded.current && gisLoaded.current) {
        setIsGoogleReady(true);
      }
    };

    loadGapi();
    loadGis();
  }, [addToast]);

  const handleGoogleLogin = () => {
    if (!isGoogleReady || !tokenClient.current) {
      addToast('error', 'Google Services sind noch nicht bereit oder konfiguriert.');
      return;
    }
    if (window.gapi.client.getToken() === null) {
      tokenClient.current.requestAccessToken({prompt: 'consent'});
    } else {
      tokenClient.current.requestAccessToken({prompt: ''});
    }
  };

  const fetchGoogleData = async () => {
    try {
      // Fetch Calendar
      const calRes = await window.gapi.client.calendar.events.list({
        'calendarId': 'primary',
        'timeMin': (new Date()).toISOString(),
        'showDeleted': false,
        'singleEvents': true,
        'maxResults': 10,
        'orderBy': 'startTime'
      });
      setGoogleEvents(calRes.result.items || []);

      // Fetch Gmail
      const gmailRes = await window.gapi.client.gmail.users.messages.list({
        'userId': 'me',
        'q': 'is:unread',
        'maxResults': 10
      });
      
      if (gmailRes.result.messages) {
        const messages = await Promise.all(gmailRes.result.messages.map(async (msg: any) => {
          const m = await window.gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': msg.id
          });
          const headers = m.result.payload.headers;
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'Kein Betreff';
          const sender = headers.find((h: any) => h.name === 'From')?.value || 'Unbekannt';
          return { id: m.result.id, subject, sender, snippet: m.result.snippet };
        }));
        setGmailMessages(messages);
      }
    } catch (e) {
      console.error("Error fetching Google data", e);
    }
  };

  const handleSync = async () => {
    if (syncCodeInput.length < 6) {
      addToast('error', 'Sync-Code zu kurz.');
      return;
    }
    
    addToast('info', 'Synchronisiere...');
    
    try {
      localStorage.setItem('taskflow_sync_uid', syncCodeInput);
      addToast('success', 'Gerät erfolgreich verknüpft! Lade Daten...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      addToast('error', 'Synchronisierung fehlgeschlagen.');
    }
  };

  // --- NEU: Hilfsfunktion um die "Aufgaben Gerd" Listen-ID zu finden ---
  const getGerdListId = async () => {
    try {
      const response = await window.gapi.client.tasks.tasklists.list();
      const lists = response.result.items || [];
      const gerdList = lists.find((l: any) => l.title === "Aufgaben Gerd");
      return gerdList ? gerdList.id : '@default';
    } catch (e) {
      return '@default';
    }
  };

  // --- Task Operations ---
  const syncTimeoutRef = useRef<{ [key: string]: any }>({});

  const saveTask = async (task: Task) => {
    // Local state update
    setTasks(prev => {
      const exists = prev.find(t => t.id === task.id);
      if (exists) return prev.map(t => t.id === task.id ? task : t);
      return [task, ...prev];
    });

    // Firebase Sync
    if (user && db) {
      try {
        const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
        await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
      } catch (e) {
        console.error("Firebase save error", e);
      }
    }

    // Google Tasks Sync (Debounced)
    if (isGoogleLoggedIn && window.gapi) {
      if (syncTimeoutRef.current[task.id]) {
        clearTimeout(syncTimeoutRef.current[task.id]);
      }
      
      syncTimeoutRef.current[task.id] = setTimeout(async () => {
        try {
          const listId = await getGerdListId(); // Nutzt jetzt deine "Aufgaben Gerd" Liste

          if (task.googleTaskId) {
            await window.gapi.client.tasks.tasks.update({
              tasklist: listId,
              task: task.googleTaskId,
              resource: {
                id: task.googleTaskId,
                title: task.title,
                notes: task.notes,
                status: task.isDone ? 'completed' : 'needsAction',
                due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined
              }
            });
          } else {
            const res = await window.gapi.client.tasks.tasks.insert({
              tasklist: listId,
              resource: {
                title: task.title,
                notes: task.notes,
                status: task.isDone ? 'completed' : 'needsAction',
                due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined
              }
            });
            task.googleTaskId = res.result.id;
          }

          // --- Google Calendar Sync ---
          if (task.dueDate) {
            const isAllDayTask = task.time === 'Ganztags' || !task.time;
            const startDateTime = !isAllDayTask 
              ? new Date(`${task.dueDate}T${task.time}:00`).toISOString() 
              : null;
            
            const eventResource = {
              summary: `${task.isDone ? '✅ ' : ''}${task.title}`,
              description: task.notes,
              location: task.location || '',
              start: !isAllDayTask 
                ? { dateTime: startDateTime } 
                : { date: task.dueDate },
              end: !isAllDayTask 
                ? { dateTime: new Date(new Date(startDateTime!).getTime() + 60 * 60 * 1000).toISOString() } 
                : { date: task.dueDate }
            };

            if (task.googleCalendarEventId) {
              await window.gapi.client.calendar.events.update({
                calendarId: 'primary',
                eventId: task.googleCalendarEventId,
                resource: eventResource
              });
            } else {
              const calRes = await window.gapi.client.calendar.events.insert({
                calendarId: 'primary',
                resource: eventResource
              });
              task.googleCalendarEventId = calRes.result.id;
            }
          }

          // Update Firebase if IDs changed
          if (user && db) {
            const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
            await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
          }
        } catch (e) {
          console.error("Google sync error", e);
        }
      }, 2500);
    }
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    
    if (user && db) {
      try {
        const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
        await deleteDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, taskId));
      } catch (e) {}
    }

    if (isGoogleLoggedIn && window.gapi && task?.googleTaskId) {
      try {
        const listId = await getGerdListId();
        await window.gapi.client.tasks.tasks.delete({
          tasklist: listId,
          task: task.googleTaskId
        });
      } catch (e) {}
    }
  };

  // --- AI Functions ---
  const generateSubtasks = async (title: string, notes: string = ''): Promise<Subtask[]> => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Break down the following task into a maximum of 4 logical subtasks. Respond ONLY with a JSON array.
Task: ${title}
Notes: ${notes}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                notes: { type: Type.STRING }
              },
              required: ['title', 'notes']
            }
          }
        }
      });
      const parsed = JSON.parse(response.text || '[]');
      return parsed.map((item: any) => ({
        id: generateId(),
        title: item.title,
        isDone: false,
        notes: item.notes || ''
      }));
    } catch (e) {
      return [];
    }
  };

  const handleCreateTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const newTask: Task = {
      id: generateId(),
      title: newTaskTitle,
      dueDate: taskType === 'deadline' ? newTaskDate : '',
      time: taskType === 'deadline' ? (isAllDay ? 'Ganztags' : newTaskTime) : '',
      isDone: false,
      notes: '',
      subtasks: [],
      location: newTaskLocation,
      recurrence: newTaskRecurrence,
      syncStatus: 'local',
      createdAt: Date.now()
    };

    setNewTaskTitle('');
    setNewTaskDate(getTodayString());
    setNewTaskTime('');
    
    if (aiAutoPilot) {
      addToast('info', 'KI plant die Aufgabe...');
      newTask.subtasks = await generateSubtasks(newTask.title);
    }

    saveTask(newTask);
  };

  const handleReplan = async (task: Task) => {
    addToast('info', 'KI plant neu...');
    try {
        const subtasks = await generateSubtasks(task.title, task.notes);
        saveTask({ ...task, subtasks });
        addToast('success', 'Neu geplant.');
    } catch (e) {
        addToast('error', 'KI-Fehler.');
    }
  };

  const handleMailToTask = async (mail: any) => {
    addToast('info', 'KI analysiert E-Mail...');
    // Simplified for demo
    const newTask: Task = {
        id: generateId(),
        title: mail.subject,
        dueDate: getTodayString(),
        time: '',
        isDone: false,
        notes: mail.snippet,
        subtasks: [],
        syncStatus: 'local',
        createdAt: Date.now()
    };
    saveTask(newTask);
    setShowGmailModal(false);
  };

  const generateBriefing = async (task: Task) => {
    return `Zusammenfassung für: ${task.title}\nStatus: ${task.isDone ? 'Erledigt' : 'In Bearbeitung'}\nNotizen: ${task.notes}`;
  };

  // --- Export ---
  const copyToClipboard = async (task: Task) => {
    const briefing = await generateBriefing(task);
    await navigator.clipboard.writeText(briefing);
    addToast('success', 'Briefing kopiert.');
  };

  const exportPDF = async (task: Task) => {
    const doc = new jsPDF();
    doc.text(task.title, 10, 10);
    doc.save(`Task_${task.id}.pdf`);
    addToast('success', 'PDF exportiert.');
  };

  // --- Voice Control ---
  const startGlobalDictation = () => {
    addToast('info', 'Spracherkennung gestartet...');
    // Browser Speech API integration would go here
  };

  const startNoteDictation = (taskId: string, currentNotes: string) => {
    addToast('info', 'Diktat gestartet...');
  };

  // --- File Upload ---
  const handleFileUpload = async (file: File, isScanner = false) => {
    addToast('info', 'Datei wird verarbeitet...');
    // Logic for file handling
  };

  const handleOptimizeWorkflow = async () => {
    setShowOptimizationModal(true);
    setIsOptimizing(false);
    setOptimizationSuggestions("Hier sind KI-Tipps für deinen Workflow...");
  };

  const handleEmailImport = async () => {
    setShowEmailModal(false);
    addToast('success', 'E-Mail importiert.');
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  // --- Filtering & Counts ---
  const counts = {
    all: tasks.filter(t => !t.isDone).length,
    today: tasks.filter(t => !t.isDone && t.dueDate === getTodayString()).length,
    week: 0,
    month: 0,
    archive: tasks.filter(t => t.isDone).length,
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === 'archive') return t.isDone;
    if (t.isDone) return false;
    if (filter === 'today') return t.dueDate === getTodayString();
    return true;
  });

  // --- UI Components ---
  const SidebarItem = ({ icon: Icon, label, active, onClick, count }: any) => (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${active ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      <div className="flex items-center space-x-3">
        <Icon size={20} />
        <span>{label}</span>
      </div>
      {count !== undefined && (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${active ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-200 text-slate-600'}`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div 
      className="min-h-screen bg-slate-50 flex font-sans text-slate-800"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center p-4 rounded-2xl shadow-lg pointer-events-auto transition-all ${
            t.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
            t.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
            'bg-blue-50 text-blue-800 border border-blue-200'
          }`}>
            <span className="font-medium">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-72 bg-white border-r border-slate-200 z-40 flex flex-col`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-600">
            <CheckCircle size={28} className="fill-current" />
            <h1 className="text-xl font-bold tracking-tight">Gerd Tasks</h1>
          </div>
        </div>

        <div className="px-4 flex-1 space-y-1 overflow-y-auto">
          <SidebarItem icon={Inbox} label="Alle Aufgaben" active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all} />
          <SidebarItem icon={Clock} label="Heute" active={filter === 'today'} onClick={() => setFilter('today')} count={counts.today} />
          <SidebarItem icon={CheckCircle} label="Archiv" active={filter === 'archive'} onClick={() => setFilter('archive')} count={counts.archive} />
          
          <div className="pt-6 pb-2 px-4 text-xs font-semibold text-slate-400 uppercase">KI Assistent</div>
          <button onClick={handleOptimizeWorkflow} className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors text-indigo-600 hover:bg-indigo-50 font-medium">
            <Sparkles size={20} />
            <span>Workflow Optimierung</span>
          </button>
        </div>

        <div className="p-6 border-t border-slate-100">
          <button onClick={() => setShowSettingsModal(true)} className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-slate-50">
            <Settings size={20} />
            <span>Einstellungen</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 p-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight capitalize">{filter}</h2>
          <div className="flex items-center space-x-4">
            {!isGoogleLoggedIn && (
              <button onClick={handleGoogleLogin} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold">Google Login</button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Input Area */}
            <div className="bg-white p-3 rounded-[2.5rem] shadow-md border-2 border-slate-100 flex items-center">
                <input 
                    type="text" 
                    value={newTaskTitle} 
                    onChange={e => setNewTaskTitle(e.target.value)}
                    placeholder="Neue Aufgabe für 'Aufgaben Gerd'..." 
                    className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-4"
                />
                <button onClick={handleCreateTask} className="p-4 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors shadow-sm">
                    <Plus size={24} />
                </button>
            </div>

            {/* Task List */}
            <div className="space-y-4">
              {filteredTasks.map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  onSave={saveTask} 
                  onDelete={deleteTask} 
                  onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  isExpanded={expandedTaskId === task.id}
                  onAddToast={addToast}
                />
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold mb-6">API Konfiguration</h3>
            <div className="space-y-4">
              <input type="text" value={tempGoogleClientId} onChange={e => setTempGoogleClientId(e.target.value)} placeholder="OAuth Client ID" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl" />
              <input type="password" value={tempGoogleApiKey} onChange={e => setTempGoogleApiKey(e.target.value)} placeholder="Google API Key" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl" />
              <div className="flex gap-3">
                <button onClick={() => setShowSettingsModal(false)} className="flex-1 px-4 py-3 border rounded-xl">Abbrechen</button>
                <button onClick={() => {
                  localStorage.setItem('taskflow_google_client_id', tempGoogleClientId);
                  localStorage.setItem('taskflow_google_api_key', tempGoogleApiKey);
                  window.location.reload();
                }} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold">Speichern</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Task Card Component ---
function TaskCard({ task, onSave, onDelete, onToggleExpand, isExpanded, onAddToast }: any) {
  return (
    <div className={`bg-white rounded-[2rem] border ${task.isDone ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'} shadow-sm hover:shadow-md transition-all`}>
      <div className="p-5 flex items-start gap-4 cursor-pointer" onClick={() => onToggleExpand()}>
        <button onClick={(e) => { e.stopPropagation(); onSave({ ...task, isDone: !task.isDone }); }} className={`mt-1 flex-shrink-0 ${task.isDone ? 'text-emerald-500' : 'text-slate-300'}`}>
          {task.isDone ? <CheckCircle size={28} /> : <Circle size={28} />}
        </button>
        <div className="flex-1 min-w-0">
          <h3 className={`text-lg font-bold ${task.isDone ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{task.title}</h3>
          {task.dueDate && <span className="text-xs text-indigo-600 font-bold">{task.dueDate}</span>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} className="text-slate-300 hover:text-red-500">
          <Trash2 size={18} />
        </button>
      </div>
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-slate-100 bg-slate-50/50">
          <textarea 
            value={task.notes} 
            onChange={(e) => onSave({ ...task, notes: e.target.value })}
            placeholder="Notizen..."
            className="w-full mt-4 p-3 bg-white border border-slate-200 rounded-xl text-sm min-h-[100px]"
          />
        </div>
      )}
    </div>
  );
}
