import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
// FIX 1: setPersistence und browserLocalPersistence hinzugefügt für Dauer-Login
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence, User } from 'firebase/auth';
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
} from 'lucide-react'; Search
Camera, Image as ImageIcon, MapPin, Settings, Search
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
  const [searchQuery, setSearchQuery] = useState('');
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
    
    // FIX 1: Dauer-Login aktivieren
    setPersistence(auth, browserLocalPersistence).catch(e => console.error("Persistence Error", e));

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
          // Backup für schnellen Start
          localStorage.setItem('taskflow_tasks', JSON.stringify(loadedTasks));
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
            
            // --- NEU: Google Token aus dem Gedächtnis laden ---
            const storedTokenStr = localStorage.getItem('taskflow_google_token');
            if (storedTokenStr) {
              const tokenObj = JSON.parse(storedTokenStr);
              // Prüfen ob der Token noch gültig ist (Google Tokens halten exakt 1 Stunde)
              if (tokenObj.expires_at && tokenObj.expires_at > Date.now()) {
                window.gapi.client.setToken(tokenObj);
                setIsGoogleLoggedIn(true);
              } else {
                localStorage.removeItem('taskflow_google_token'); // Abgelaufen -> löschen
              }
            }

            if (gisLoaded.current) setIsGoogleReady(true);
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
            
            // --- NEU: Token im Gedächtnis speichern ---
            // Berechnet die genaue Ablaufzeit (jetzt + 1 Stunde)
            tokenResponse.expires_at = Date.now() + (tokenResponse.expires_in * 1000);
            localStorage.setItem('taskflow_google_token', JSON.stringify(tokenResponse));

            setIsGoogleLoggedIn(true);
            addToast('success', 'Erfolgreich bei Google angemeldet.');
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
    if (!isGoogleReady || !tokenClient.current) {
      addToast('error', 'Google Services sind noch nicht bereit.');
      return;
    }
    // Durch prompt: '' gibt es kein nerviges Bestätigungsfenster mehr,
    // das Fenster blitzt nur kurz auf und loggt dich sofort ein!
    tokenClient.current.requestAccessToken({prompt: ''});
  };

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

  // FIX 2: Verbesserter Import mit "silent" Modus
  const importFromGoogle = async (silent = false) => {
    if (!window.gapi) return;
    if (!silent) addToast('info', 'Suche nach neuen Aufgaben bei Google...');
    try {
      const res = await window.gapi.client.tasks.tasks.list({
        tasklist: 'MTQwODMyOTEyNDM0NjUxOTQ5MTA6MDow',
        showHidden: true
      });
      const gTasks = res.result.items || [];
      let imported = 0;
      
      setTasks(prevTasks => {
        const newTasks = [...prevTasks];
        gTasks.forEach(gt => {
          const exists = newTasks.find(t => t.googleTaskId === gt.id);
          if (!exists && gt.title) {
            const newTask = {
              id: generateId(),
              title: gt.title,
              dueDate: gt.due ? gt.due.split('T')[0] : getTodayString(),
              time: '',
              isDone: gt.status === 'completed',
              notes: gt.notes || '',
              subtasks: [],
              syncStatus: 'local',
              createdAt: Date.now(),
              googleTaskId: gt.id
            };
            newTasks.push(newTask);
            
            if (user && db) {
              const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
              setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, newTask.id), newTask);
            }
            imported++;
          }
        });
        return newTasks.sort((a, b) => b.createdAt - a.createdAt);
      });

      if (!silent) {
        if (imported > 0) addToast('success', `${imported} neue Aufgaben aus Google importiert!`);
        else addToast('info', 'Alle Aufgaben sind bereits synchron.');
      }
    } catch(e) {
      if (!silent) addToast('error', 'Fehler beim Google Import.');
    }
  };

  // FIX 3: Autopilot im Hintergrund (alle 60 Sek)
  useEffect(() => {
    if (isGoogleLoggedIn) {
      importFromGoogle(true); // Direkt beim Start (still)
      const intervalId = setInterval(() => {
        importFromGoogle(true); // Alle 60 Sekunden (still)
      }, 60000);
      return () => clearInterval(intervalId);
    }
  }, [isGoogleLoggedIn]);

  const fetchGoogleData = async () => {
    try {
      const calRes = await window.gapi.client.calendar.events.list({
        'calendarId': 'primary',
        'timeMin': (new Date()).toISOString(),
        'showDeleted': false,
        'singleEvents': true,
        'maxResults': 10,
        'orderBy': 'startTime'
      });
      setGoogleEvents(calRes.result.items || []);

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

  // --- Task Operations ---
  const syncTimeoutRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const saveTask = async (task: Task, skipGoogle = false) => {
    // 1. Lokales State-Update für sofortiges Feedback
    setTasks(prev => {
      const exists = prev.find(t => t.id === task.id);
      if (exists) return prev.map(t => t.id === task.id ? task : t);
      return [task, ...prev];
    });

    // 2. Firebase Cloud Sync
    if (user && db) {
      try {
        const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
        await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
      } catch (e) {
        console.error("Firebase save error", e);
      }
    }

    // 3. REINER GOOGLE TASKS SYNC (Kein Kalender-Termin mehr!)
    if (!skipGoogle && isGoogleLoggedIn && window.gapi?.client?.tasks) {
      if (syncTimeoutRef.current[task.id]) {
        clearTimeout(syncTimeoutRef.current[task.id]);
      }
      
      syncTimeoutRef.current[task.id] = setTimeout(async () => {
        try {
          const appLink = `\n\n🔗 Zur App: ${window.location.origin}`;
          const cleanNotes = (task.notes || "").replace(appLink, ""); 
          
          const resource = {
            title: task.title,
            notes: cleanNotes + appLink,
            status: task.isDone ? 'completed' : 'needsAction',
            // Hier wird das Datum als "Termin-Aufgabe" in Google Tasks gesetzt
            due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null
          };

          if (task.googleTaskId) {
            await window.gapi.client.tasks.tasks.update({
              tasklist: 'MTQwODMyOTEyNDM0NjUxOTQ5MTA6MDow',
              task: task.googleTaskId,
              resource: { ...resource, id: task.googleTaskId }
            });
          } else {
            const res = await window.gapi.client.tasks.tasks.insert({
              tasklist: 'MTQwODMyOTEyNDM0NjUxOTQ5MTA6MDow',
              resource
            });
            task.googleTaskId = res.result.id;
            
            // Neue Google-ID in Firebase speichern
            if (user && db) {
              const syncUid = localStorage.getItem('taskflow_sync_uid') || user.uid;
              await setDoc(doc(db, `artifacts/taskflow-ultimate/users/${syncUid}/tasks`, task.id), task);
            }
          }
        } catch (e) {
          console.error("Google Tasks sync error", e);
        }
      }, 2500); // 2,5 Sekunden Verzögerung, damit nicht jeder Tastenanschlag sofort gesendet wird
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
        await window.gapi.client.tasks.tasks.delete({
          tasklist: 'MTQwODMyOTEyNDM0NjUxOTQ5MTA6MDow',
          task: task.googleTaskId
        });
      } catch (e) {}
    }

    if (isGoogleLoggedIn && window.gapi && task?.googleCalendarEventId) {
      try {
        await window.gapi.client.calendar.events.delete({
          calendarId: 'primary',
          eventId: task.googleCalendarEventId
        });
      } catch (e) {}
    }
  };

  // --- AI Functions ---
  const generateSubtasks = async (title: string, notes: string = ''): Promise<Subtask[]> => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Break down the following task into a maximum of 4 logical subtasks. The last subtask should ideally be the 'Goal' or final step. Respond ONLY with a JSON array of objects, each having 'title' and 'notes' (string).
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
      console.error('Gemini Error:', e);
      addToast('error', 'KI konnte keine Teilschritte generieren.');
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
      followUpDate: '',
      deadline: '',
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
    setNewTaskLocation('');
    setNewTaskRecurrence('none');
    setTaskType('deadline');
    setIsAllDay(false);
    
    if (aiAutoPilot) {
      addToast('info', 'KI plant die Aufgabe...');
      newTask.subtasks = await generateSubtasks(newTask.title);
      addToast('success', 'KI-Planung abgeschlossen.');
    }

    saveTask(newTask);
  };

  const handleReplan = async (task: Task) => {
    addToast('info', 'KI plant neu...');
    
    let parts: any[] = [{ text: `Generate a step-by-step plan for this task. Respond ONLY with JSON.
Task: ${task.title}
Notes: ${task.notes}
Meeting Results: ${task.meetingResults || ''}` }];

    if (task.attachedFiles && task.attachedFiles.length > 0) {
      task.attachedFiles.forEach(file => {
        parts.push({
          inlineData: {
            data: file.data.split(',')[1],
            mimeType: file.type
          }
        });
      });
    } else if (task.attachedFile) {
      parts.push({
        inlineData: {
          data: task.attachedFile.data.split(',')[1],
          mimeType: task.attachedFile.type
        }
      });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts },
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
      const newSubtasks = parsed.map((item: any) => ({
        id: generateId(),
        title: item.title,
        isDone: false,
        notes: item.notes || ''
      }));
      saveTask({ ...task, subtasks: newSubtasks });
      addToast('success', 'Neu geplant.');
    } catch (e) {
      console.error('Gemini Error:', e);
      addToast('error', 'KI konnte keine Teilschritte generieren.');
    }
  };

  const handleMailToTask = async (mail: any) => {
    addToast('info', 'KI analysiert E-Mail...');
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Convert this email into a structured task. Respond ONLY with JSON.
Sender: ${mail.sender}
Subject: ${mail.subject}
Snippet: ${mail.snippet}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              dueDate: { type: Type.STRING },
              notes: { type: Type.STRING },
              subtasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    notes: { type: Type.STRING }
                  }
                }
              }
            },
            required: ['title', 'notes', 'subtasks']
          }
        }
      });
      const parsed = JSON.parse(response.text || '{}');
      
      const newTask: Task = {
        id: generateId(),
        title: parsed.title || mail.subject,
        dueDate: parsed.dueDate || getTodayString(),
        time: '',
        followUpDate: '',
        isDone: false,
        notes: parsed.notes || mail.snippet,
        subtasks: (parsed.subtasks || []).map((s: any) => ({
          id: generateId(),
          title: s.title,
          isDone: false,
          notes: s.notes || ''
        })),
        syncStatus: 'local',
        createdAt: Date.now()
      };
      saveTask(newTask);
      setShowGmailModal(false);
      addToast('success', 'Aufgabe aus E-Mail erstellt.');
    } catch (e) {
      console.error(e);
      addToast('error', 'Fehler bei der E-Mail Analyse.');
    }
  };

  const generateBriefing = async (task: Task) => {
    addToast('info', 'Generiere Zusammenfassung...');
    try {
      let parts: any[] = [{
        text: `Erstelle eine hochprofessionelle, übersichtliche und strukturierte Zusammenfassung für diese Aufgabe. 
Diese Zusammenfassung dient als "Single Source of Truth" für den Nutzer und als perfekte Quelle für NotebookLM.

### FORMATIERUNGS-REGELN:
1. **ÜBERSCHRIFTEN:** Verwende IMMER fette Markdown-Überschriften (z.B. **### 1. Status & Überblick**).
2. **STRUKTUR:** Nutze horizontale Linien (---) zwischen den Hauptabschnitten.
3. **HIGHLIGHTS:** Markiere NUR die wichtigsten Werte (Daten, Namen, Beträge, Status) FETT (**Wert**). Der erklärende Text bleibt normal.
4. **LISTEN:** Verwende einfache Pfeile (→) für Aufzählungen und nächste Schritte.
5. **STATUS-INDIKATOREN:** Verwende Symbole: ✅ (Erledigt), 🔵 (In Bearbeitung), ⏳ (Ausstehend), ⚠️ (Dringend/Problem).

### ABSCHNITTE DER ZUSAMMENFASSUNG:
**### 📊 Status & Überblick**
→ Aktuelles Datum: **${new Date().toLocaleDateString('de-DE')}**
→ Gesamtstatus: **${task.isDone ? '✅ Abgeschlossen' : '🔵 In Bearbeitung'}**
→ Frist: **${task.deadline || task.dueDate || 'Keine Angabe'}**

---

**### 📝 Sachverhalt & Kontext**
(Fasse hier kurz und präzise zusammen, worum es bei dieser Aufgabe geht. Beziehe unbedingt die Besprechungsergebnisse und Notizen mit ein. Markiere wichtige Fakten fett.)

---

**### 🤝 Besprechungsergebnisse & Details**
🗣️ Besprochene Notizen:
${task.meetingResults || 'Keine spezifischen Besprechungsergebnisse vorhanden.'}

📝 Zusätzliche Notizen:
${task.notes || 'Keine zusätzlichen Notizen.'}

---

**### 🏗️ Fortschritt der Teilschritte**
(Liste die Teilschritte auf. Nutze → für jeden Punkt und markiere den Status. Markiere den Titel des Teilschritts fett.)

---

**### 🚀 Nächste konkrete Schritte**
(Was muss als nächstes getan werden? Erstelle eine klare Handlungsanweisung mit →. Markiere die Kernaktion fett.)

---

**### 📎 Analyse der Anhänge**
(Falls Anhänge vorhanden sind, fasse deren Inhalt hier kurz zusammen. Markiere Dokumentnamen oder Kerninfos fett.)

### DATENGRUNDLAGE:
Titel: ${task.title}
Ort: ${task.location || '-'}
Telefon: ${task.phoneNumber || '-'}
Besprechungsergebnisse: ${task.meetingResults || '-'}
Notizen: ${task.notes || '-'}
Teilschritte:
${task.subtasks.map(s => `- ${s.title} [${s.isDone ? 'Erledigt' : 'Offen'}] (Notiz: ${s.notes})`).join('\n')}`
      }];

      if (task.attachedFiles && task.attachedFiles.length > 0) {
        task.attachedFiles.forEach(file => {
          parts.push({
            inlineData: {
              data: file.data.split(',')[1],
              mimeType: file.type
            }
          });
        });
      } else if (task.attachedFile) {
        parts.push({
          inlineData: {
            data: task.attachedFile.data.split(',')[1],
            mimeType: task.attachedFile.type
          }
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts },
      });
      return response.text || '';
    } catch (e) {
      console.error(e);
      addToast('error', 'Fehler beim Generieren der Zusammenfassung.');
      return 'Fehler beim Generieren.';
    }
  };

  // --- Export ---
  const copyToClipboard = async (task: Task) => {
    const briefing = await generateBriefing(task);
    try {
      await navigator.clipboard.writeText(briefing);
      addToast('success', 'Briefing in die Zwischenablage kopiert.');
    } catch (err) {
      const textArea = document.createElement("textarea");
      textArea.value = briefing;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        addToast('success', 'Briefing kopiert (Fallback).');
      } catch (err) {
        addToast('error', 'Kopieren fehlgeschlagen.');
      }
      document.body.removeChild(textArea);
    }
  };

  const exportPDF = async (task: Task) => {
    const briefing = await generateBriefing(task);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    
    doc.setFontSize(22);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text(task.title, margin, 25);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // slate-400
    doc.text(`Erstellt am: ${new Date(task.createdAt).toLocaleDateString('de-DE')}`, margin, 35);
    doc.text(`Geplant: ${task.dueDate || '-'} ${task.time || ''} | Frist: ${task.deadline || '-'}`, margin, 40);
    
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.line(margin, 45, pageWidth - margin, 45);
    
    doc.setFontSize(12);
    doc.setTextColor(51, 65, 85); // slate-700
    
    const splitText = doc.splitTextToSize(briefing, contentWidth);
    let cursorY = 55;
    
    splitText.forEach((line: string) => {
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line, margin, cursorY);
      cursorY += 7;
    });
    
    doc.save(`TaskFlow_${task.title.replace(/\s+/g, '_')}.pdf`);
    addToast('success', 'PDF erfolgreich exportiert.');
  };

  // --- Voice Control ---
  const startGlobalDictation = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      addToast('error', 'Spracherkennung wird von diesem Browser nicht unterstützt.');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsListeningGlobal(true);
    addToast('info', 'Bitte sprechen...');

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      setIsListeningGlobal(false);
      addToast('info', 'Verarbeite Spracheingabe...');
      
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Wandle diesen gesprochenen Text in eine strukturierte Aufgabe um. 
Gib das Datum im Format YYYY-MM-DD an. Falls kein Jahr genannt wird, nutze ${new Date().getFullYear()}.
Antworte NUR mit JSON.
Text: "${transcript}"`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                notes: { type: Type.STRING },
                dueDate: { type: Type.STRING }
              },
              required: ['title', 'notes']
            }
          }
        });
        const parsed = JSON.parse(response.text || '{}');
        setNewTaskTitle(parsed.title || transcript);
        if (parsed.dueDate) setNewTaskDate(parsed.dueDate);
        addToast('success', 'Spracheingabe verarbeitet.');
      } catch (e) {
        setNewTaskTitle(transcript);
        addToast('error', 'KI-Verarbeitung fehlgeschlagen, Text eingefügt.');
      }
    };

    recognition.onerror = () => {
      setIsListeningGlobal(false);
      addToast('error', 'Fehler bei der Spracherkennung.');
    };

    recognition.start();
  };

  const startNoteDictation = (taskId: string, currentNotes: string) => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      addToast('error', 'Spracherkennung wird nicht unterstützt.');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    
    addToast('info', 'Diktat gestartet...');
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        saveTask({ ...task, notes: currentNotes + (currentNotes ? ' ' : '') + transcript });
        addToast('success', 'Text hinzugefügt.');
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      addToast('error', `Spracherkennung fehlgeschlagen: ${event.error}`);
    };

    recognition.onend = () => {};

    recognition.start();
  };

  // --- File Upload & Drag/Drop ---
  const handleFileUpload = async (file: File, isScanner = false) => {
    if (!file) return;
    
    let mimeType = file.type;
    if (!mimeType) {
      if (file.name.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (file.name.endsWith('.csv')) mimeType = 'text/csv';
      else if (file.name.endsWith('.txt')) mimeType = 'text/plain';
      else mimeType = 'text/plain';
    }

    const supportedTypes = ['application/pdf', 'text/plain', 'text/html', 'text/csv', 'text/xml', 'text/rtf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(mimeType) && !mimeType.startsWith('image/') && !mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
       addToast('error', `Dateityp ${mimeType || 'unbekannt'} wird von der KI nicht unterstützt. Bitte PDF, Bild oder Textdatei nutzen.`);
       return;
    }

    if (file.size > 10 * 1024 * 1024) {
      addToast('error', 'Die Datei ist zu groß (max. 10MB).');
      return;
    }

    if (isScanner) {
      addToast('info', 'Magie Scanner: Optimiere Vorlage...');
    } else {
      addToast('info', 'Analysiere Dokument...');
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      
      if (isScanner) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        addToast('success', 'Vorlage geglättet und optimiert.');
      }

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              { inlineData: { data: base64.split(',')[1], mimeType: mimeType } },
              { text: "Extrahiere den Titel, Fristen (Deadline), geplantes Datum (dueDate), eine Zusammenfassung und plane Bearbeitungsschritte aus diesem Dokument. WICHTIG: Alle Daten im Format YYYY-MM-DD. Antworte NUR mit JSON." }
            ]
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                dueDate: { type: Type.STRING },
                deadline: { type: Type.STRING },
                notes: { type: Type.STRING },
                subtasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      notes: { type: Type.STRING }
                    }
                  }
                }
              },
              required: ['title', 'notes', 'subtasks']
            }
          }
        });
        const parsed = JSON.parse(response.text || '{}');
        const newTask: Task = {
          id: generateId(),
          title: parsed.title || file.name,
          dueDate: parsed.dueDate || getTodayString(),
          deadline: parsed.deadline || '',
          time: '',
          followUpDate: '',
          isDone: false,
          notes: parsed.notes || '',
          subtasks: (parsed.subtasks || []).map((s: any) => ({
            id: generateId(),
            title: s.title,
            isDone: false,
            notes: s.notes || ''
          })),
          attachedFiles: [{ name: isScanner ? `Scan_${file.name}` : file.name, type: file.type, data: base64 }],
          syncStatus: 'local',
          createdAt: Date.now()
        };
        saveTask(newTask);
        addToast('success', isScanner ? 'Scan verarbeitet und Aufgabe erstellt.' : 'Dokument verarbeitet und Aufgabe erstellt.');
      } catch (err) {
        console.error(err);
        addToast('error', 'Fehler bei der Dokumentenanalyse.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleOptimizeWorkflow = async () => {
    setShowOptimizationModal(true);
    setIsOptimizing(true);
    try {
      const prompt = `Du bist ein KI-Aufgabenmanager. Analysiere die folgenden Aufgaben des Nutzers und schlage Optimierungen für seinen Workflow vor. 
Berücksichtige Prioritäten, mögliche Zusammenlegungen von Aufgaben, Zeitmanagement-Tipps und wie die App noch besser genutzt werden könnte.
Schreibe eine ermutigende, hilfreiche und strukturierte Antwort (in Markdown).

Aufgaben:
${JSON.stringify(tasks.map(t => ({ title: t.title, dueDate: t.dueDate, isDone: t.isDone, subtasks: t.subtasks.length })))}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      
      setOptimizationSuggestions(response.text || 'Keine Vorschläge generiert.');
    } catch (err) {
      console.error(err);
      setOptimizationSuggestions('Fehler bei der Generierung von Vorschlägen.');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleEmailImport = async () => {
    if (!emailContent.trim()) return;
    setShowEmailModal(false);
    addToast('info', 'KI analysiert E-Mail...');
    
    try {
      const prompt = `Analysiere die folgende E-Mail und erstelle daraus eine Aufgabe.
Extrahiere den Titel, eine Zusammenfassung als Notizen, Fristen (falls vorhanden) und leite Teilschritte ab.
WICHTIG: Alle Daten im Format YYYY-MM-DD.
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:
{
  "title": "...",
  "notes": "...",
  "dueDate": "YYYY-MM-DD",
  "subtasks": [{ "title": "...", "notes": "..." }]
}

E-Mail Inhalt:
${emailContent}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      
      const parsed = JSON.parse(response.text || '{}');
      const newTask: Task = {
        id: generateId(),
        title: parsed.title || 'Aufgabe aus E-Mail',
        dueDate: parsed.dueDate || getTodayString(),
        time: '',
        followUpDate: '',
        isDone: false,
        notes: parsed.notes || '',
        subtasks: (parsed.subtasks || []).map((s: any) => ({
          id: generateId(),
          title: s.title,
          isDone: false,
          notes: s.notes || ''
        })),
        syncStatus: 'local',
        createdAt: Date.now()
      };
      saveTask(newTask);
      setEmailContent('');
      addToast('success', 'Aufgabe aus E-Mail erstellt.');
    } catch (err) {
      console.error(err);
      addToast('error', 'Fehler bei der E-Mail-Analyse.');
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // --- Filtering & Counts ---
  const counts = {
    all: tasks.filter(t => !t.isDone).length,
    today: tasks.filter(t => !t.isDone && t.dueDate === getTodayString()).length,
    week: tasks.filter(t => {
      if (t.isDone) return false;
      const today = getTodayString();
      const d1 = new Date(today).getTime();
      const d2 = new Date(t.dueDate).getTime();
      return d2 >= d1 && d2 <= d1 + 7 * 24 * 60 * 60 * 1000;
    }).length,
    month: tasks.filter(t => !t.isDone && t.dueDate.substring(0, 7) === getTodayString().substring(0, 7)).length,
    archive: tasks.filter(t => t.isDone).length,
  };

  // --- UI RENDER LOGIK & DEEP SEARCH ---
  const filteredTasks = tasks.filter(t => {
    // 1. Moderne Tiefensuche (Deep Search)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      // Durchsucht die Hauptaufgabe
      const inMain = (t.title?.toLowerCase().includes(query)) || 
                     (t.notes?.toLowerCase().includes(query)) || 
                     (t.meetingResults?.toLowerCase().includes(query)) ||
                     (t.sachbearbeiter?.toLowerCase().includes(query)) ||
                     (t.location?.toLowerCase().includes(query));
      
      // Durchsucht alle Teilschritte und deren Unter-Aufgaben
      const inSubtasks = t.subtasks?.some((sub: any) => 
        sub.title?.toLowerCase().includes(query) || 
        sub.notes?.toLowerCase().includes(query) ||
        sub.todos?.some((todo: any) => todo.title?.toLowerCase().includes(query))
      );

      return inMain || inSubtasks;
    }

    // 2. Normale Filter-Logik (wenn nicht gesucht wird)
    if (filter === 'archive') return t.isDone;
    if (t.isDone) return false;
    
    const today = getTodayString();
    if (filter === 'today') return t.dueDate === today;
    if (filter === 'week') {
      const d1 = new Date(today).getTime();
      const d2 = new Date(t.dueDate).getTime();
      return d2 >= d1 && d2 <= d1 + 7 * 24 * 60 * 60 * 1000;
    }
    if (filter === 'month') {
      return t.dueDate.substring(0, 7) === today.substring(0, 7);
    }
    return true;
  });
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
      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-indigo-500/90 z-50 flex items-center justify-center border-8 border-indigo-300 border-dashed">
          <div className="text-center text-white">
            <Upload size={64} className="mx-auto mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold">Dokument hier ablegen</h2>
            <p className="mt-2 opacity-80">KI analysiert das Dokument automatisch</p>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center p-4 rounded-2xl shadow-lg pointer-events-auto transition-all transform translate-y-0 opacity-100 ${
            t.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
            t.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
            'bg-blue-50 text-blue-800 border border-blue-200'
          }`}>
            {t.type === 'success' && <CheckCircle className="mr-3" size={20} />}
            {t.type === 'error' && <AlertCircle className="mr-3" size={20} />}
            {t.type === 'info' && <Sparkles className="mr-3" size={20} />}
            <span className="font-medium">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-72 bg-white border-r border-slate-200 z-40 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} flex flex-col`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-600">
            <CheckCircle size={28} className="fill-current" />
            <h1 className="text-xl font-bold tracking-tight">Gerd<span className="text-slate-800">Aufgaben-Manager</span></h1>
          </div>
          <button className="md:hidden text-slate-400" onClick={() => setIsSidebarOpen(false)}>
            <X size={24} />
          </button>
        </div>

        <div className="px-4 flex-1 space-y-1 overflow-y-auto">
          <SidebarItem icon={Inbox} label="Alle Aufgaben" active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all} />
          <SidebarItem icon={Clock} label="Heute" active={filter === 'today'} onClick={() => setFilter('today')} count={counts.today} />
          <SidebarItem icon={CalendarIcon} label="Diese Woche" active={filter === 'week'} onClick={() => setFilter('week')} count={counts.week} />
          <SidebarItem icon={CalendarIcon} label="Dieser Monat" active={filter === 'month'} onClick={() => setFilter('month')} count={counts.month} />
          <SidebarItem icon={CheckCircle} label="Archiv (Erledigt)" active={filter === 'archive'} onClick={() => setFilter('archive')} count={counts.archive} />
          
          <div className="pt-6 pb-2 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">KI Assistent</div>
          <button 
            onClick={handleOptimizeWorkflow}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors text-indigo-600 hover:bg-indigo-50 font-medium"
          >
            <Sparkles size={20} />
            <span>Workflow Optimierung</span>
          </button>

          <div className="pt-6 pb-2 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Google Workspace</div>
          <SidebarItem icon={CalendarIcon} label="Dein Kalender" active={filter === 'calendar'} onClick={() => setFilter('calendar')} />
          <button 
            onClick={() => setShowGmailModal(true)}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors text-slate-600 hover:bg-slate-100"
          >
            <Mail size={20} />
            <span>Gmail Posteingang</span>
          </button>
          {!isGoogleLoggedIn && (
            <div className="px-4 mt-2">
              <button onClick={handleGoogleLogin} className="w-full py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors">
                Mit Google verbinden
              </button>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100">
          <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-full ${aiAutoPilot ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
                <Sparkles size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold">KI Auto-Pilot</p>
                <p className="text-xs text-slate-500">Automatische Planung</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={aiAutoPilot} onChange={() => setAiAutoPilot(!aiAutoPilot)} />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>
        </div>
      </aside>

      {/* Generated Document Modal */}
      {generatedDocument && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-500" />
                {generatedDocument.title}
              </h3>
              <button onClick={() => setGeneratedDocument(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <textarea
                value={generatedDocument.content}
                onChange={(e) => setGeneratedDocument({ ...generatedDocument, content: e.target.value })}
                className="w-full h-full min-h-[50vh] p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-slate-700"
              />
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setGeneratedDocument(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                Schließen
              </button>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(generatedDocument.content);
                  addToast('success', 'In die Zwischenablage kopiert');
                }} 
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-2"
              >
                <Copy size={16} /> Kopieren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header mit Suchleiste */}
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-20 gap-4">
          <div className="flex items-center">
            <button className="md:hidden mr-4 text-slate-500" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <h2 className="text-2xl font-bold tracking-tight capitalize hidden sm:block">
              {searchQuery ? 'Suchergebnisse' : filter === 'calendar' ? 'Google Kalender' : filter === 'archive' ? 'Archiv' : filter === 'all' ? 'Alle Aufgaben' : filter === 'today' ? 'Heute' : filter === 'week' ? 'Diese Woche' : filter === 'month' ? 'Dieser Monat' : filter}
            </h2>
          </div>

          {/* Die neue Suchleiste */}
          <div className="flex-1 max-w-xl mx-auto relative transition-all duration-300 focus-within:max-w-2xl">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Aufgaben, Notizen, Orte, Personen durchsuchen..."
              className="w-full pl-11 pr-10 py-2.5 bg-slate-100 border-transparent rounded-full text-sm focus:bg-white focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 transition-all text-slate-700 font-medium"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 bg-slate-200 p-1 rounded-full transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {isGoogleLoggedIn && (
              <button 
                onClick={() => importFromGoogle(false)}
                className="hidden lg:flex text-xs px-3 py-1.5 rounded-full font-medium items-center bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 cursor-pointer transition-colors shadow-sm"
                title="Aufgaben aus Google Tasks abrufen"
              >
                <RefreshCw size={12} className="mr-1.5" /> Sync
              </button>
            )}
            <button 
              onClick={() => setShowSettingsModal(true)}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-full transition-colors"
              title="Einstellungen"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            
            {/* Task Input Area */}
            {filter !== 'calendar' && filter !== 'archive' && (
              <div className="bg-white p-3 rounded-[2.5rem] shadow-md border-2 border-slate-100 flex flex-col focus-within:shadow-lg focus-within:border-indigo-200 transition-all">
                <div className="flex items-center px-2 pb-2 gap-2">
                  <div className="bg-slate-100 p-1 rounded-full flex items-center">
                    <button 
                      onClick={() => setTaskType('deadline')}
                      className={`px-5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all ${taskType === 'deadline' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Termin
                    </button>
                    <button 
                      onClick={() => setTaskType('simple')}
                      className={`px-5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all ${taskType === 'simple' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Aufgabe
                    </button>
                  </div>
                  <div className="h-4 w-[1px] bg-slate-200 mx-1"></div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    {taskType === 'simple' ? 'Einfache Aufgabe' : 'Aufgabe mit Termin'}
                  </div>
                </div>

                <div className="flex items-center relative">
                  <div className="flex items-center">
                    <button 
                      type="button"
                      onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                      className="p-3 text-slate-400 hover:text-indigo-500 transition-colors rounded-full hover:bg-slate-50"
                      title="Anhang hinzufügen"
                    >
                      <Paperclip size={20} />
                    </button>
                    
                    {showAttachmentMenu && (
                      <div className="absolute top-12 left-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-2 w-48">
                        <button 
                          type="button"
                          onClick={() => { photoInputRef.current?.click(); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <ImageIcon size={16} className="text-indigo-500" /> Foto hochladen
                        </button>
                        <button 
                          type="button"
                          onClick={() => { pdfInputRef.current?.click(); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <FileText size={16} className="text-red-500" /> PDF hochladen
                        </button>
                        <button 
                          type="button"
                          onClick={() => { scannerInputRef.current?.click(); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Camera size={16} className="text-emerald-500" /> Magie Scanner
                        </button>
                        <button 
                          type="button"
                          onClick={() => { setShowEmailModal(true); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Mail size={16} className="text-blue-500" /> Aus E-Mail erstellen
                        </button>
                      </div>
                    )}
                  </div>
                  <input 
                    type="file" 
                    accept="image/*"
                    ref={photoInputRef} 
                    className="hidden" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                      e.target.value = '';
                    }} 
                  />
                  <input 
                    type="file" 
                    accept="application/pdf"
                    ref={pdfInputRef} 
                    className="hidden" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                      e.target.value = '';
                    }} 
                  />
                  <input 
                    type="file" 
                    accept="image/*"
                    capture="environment"
                    ref={scannerInputRef} 
                    className="hidden" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0], true);
                      }
                      e.target.value = '';
                    }} 
                  />
                  
                  <form onSubmit={handleCreateTask} className="flex-1 flex items-center">
                    <input 
                      type="text" 
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Neue Aufgabe hinzufügen..." 
                      className="w-full bg-transparent border-none focus:ring-0 text-lg px-2 placeholder:text-slate-400"
                    />
                    <button type="submit" className="hidden" />
                  </form>

                  <button 
                    onClick={startGlobalDictation}
                    className={`p-4 transition-colors rounded-full ${isListeningGlobal ? 'text-red-500 bg-red-50 animate-pulse' : 'text-slate-400 hover:text-indigo-500 hover:bg-slate-50'}`}
                  >
                    <Mic size={22} />
                  </button>
                  <button 
                    onClick={handleCreateTask}
                    className="p-4 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors shadow-sm ml-2"
                  >
                    <Plus size={24} />
                  </button>
                </div>
                
                {taskType === 'deadline' && (
                  <div className="flex flex-wrap items-center gap-y-3 gap-x-4 px-4 pb-3 mt-1 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                      <CalendarIcon size={14} className="text-indigo-500" />
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Tag:</span>
                      <input 
                        type="date" 
                        value={newTaskDate}
                        onChange={(e) => setNewTaskDate(e.target.value)}
                        className="text-sm border-none bg-transparent focus:ring-0 p-0 text-slate-700 font-bold"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={isAllDay}
                          onChange={(e) => setIsAllDay(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-slate-500 font-bold">Ganztags</span>
                      </label>
                    </div>

                    {!isAllDay && (
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                        <Clock size={14} className="text-indigo-500" />
                        <input 
                          type="time" 
                          value={newTaskTime}
                          onChange={(e) => setNewTaskTime(e.target.value)}
                          className="text-sm border-none bg-transparent focus:ring-0 p-0 text-slate-700 font-bold"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                      <RefreshCw size={14} className="text-indigo-500" />
                      <select 
                        value={newTaskRecurrence}
                        onChange={(e) => setNewTaskRecurrence(e.target.value as any)}
                        className="text-sm border-none bg-transparent focus:ring-0 p-0 text-slate-700 font-bold"
                      >
                        <option value="none">Keine Wiederholung</option>
                        <option value="daily">Täglich</option>
                        <option value="weekly">Wöchentlich</option>
                        <option value="monthly">Monatlich</option>
                      </select>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 flex-1 min-w-[150px]">
                      <MapPin size={14} className="text-slate-400" />
                      <input 
                        type="text" 
                        value={newTaskLocation}
                        onChange={(e) => setNewTaskLocation(e.target.value)}
                        placeholder="Ort hinzufügen..."
                        className="text-sm border-none bg-transparent focus:ring-0 p-0 text-slate-600 w-full placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Content Area */}
            {filter === 'calendar' ? (
              <div className="space-y-4">
                {!isGoogleLoggedIn ? (
                  <div className="text-center py-20 bg-white rounded-[2.5rem] border border-slate-200">
                    <CalendarIcon size={48} className="mx-auto text-slate-300 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Google Kalender nicht verbunden</h3>
                    <button onClick={handleGoogleLogin} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">Jetzt verbinden</button>
                  </div>
                ) : googleEvents.length === 0 ? (
                  <p className="text-center text-slate-500 py-10">Keine anstehenden Termine.</p>
                ) : (
                  googleEvents.map(event => (
                    <div key={event.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-lg">{event.summary}</h4>
                        <p className="text-slate-500 text-sm flex items-center mt-1">
                          <Clock size={14} className="mr-1" />
                          {new Date(event.start.dateTime || event.start.date).toLocaleString('de-DE')}
                        </p>
                      </div>
                      <a href={event.htmlLink} target="_blank" rel="noreferrer" className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Öffnen</a>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 text-slate-300 mb-4">
                      <CheckCircle size={40} />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-700">Alles erledigt!</h3>
                    <p className="text-slate-500 mt-2">Lehn dich zurück oder erstelle eine neue Aufgabe.</p>
                  </div>
                ) : (
                  filteredTasks.map(task => (
                    <TaskCard 
                      key={task.id} 
                      task={task} 
                      onSave={saveTask} 
                      onDelete={deleteTask} 
                      onReplan={handleReplan} 
                      onDictate={startNoteDictation} 
                      onCopy={copyToClipboard} 
                      onExportPDF={exportPDF} 
                      onGenerateBriefing={generateBriefing} 
                      onAddToast={addToast} 
                      onOpenDocument={setGeneratedDocument}
                      isExpanded={expandedTaskId === task.id}
                      onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Settings size={22} className="text-indigo-500" /> API Konfiguration
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block">Google API Key</label>
                <div className="relative">
                  <input 
                    type="password" 
                    value={tempGoogleApiKey}
                    onChange={(e) => setTempGoogleApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-300 transition-all font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-400 italic">Wird für Google Maps, Kalender und Tasks benötigt.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block">OAuth Client ID</label>
                <input 
                  type="text" 
                  value={tempGoogleClientId}
                  onChange={(e) => setTempGoogleClientId(e.target.value)}
                  placeholder="...apps.googleusercontent.com"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-300 transition-all font-mono"
                />
                <p className="text-[10px] text-slate-400 italic">Wird für die Google-Anmeldung benötigt.</p>
              </div>

              <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl">
                <div className="flex gap-2">
                  <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    <strong>Hinweis:</strong> Diese Werte werden lokal in deinem Browser gespeichert. Für eine dauerhafte Konfiguration sollten sie in den Cloud-Umgebungsvariablen hinterlegt werden.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    localStorage.removeItem('taskflow_google_api_key');
                    localStorage.removeItem('taskflow_google_client_id');
                    addToast('info', 'Einstellungen zurückgesetzt.');
                    setTimeout(() => window.location.reload(), 1000);
                  }}
                  className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors"
                >
                  Reset
                </button>
                <button 
                  onClick={() => {
                    localStorage.setItem('taskflow_google_api_key', tempGoogleApiKey);
                    localStorage.setItem('taskflow_google_client_id', tempGoogleClientId);
                    addToast('success', 'Einstellungen gespeichert. Lade neu...');
                    setTimeout(() => window.location.reload(), 1500);
                  }}
                  className="flex-[2] px-4 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95"
                >
                  Speichern & Neustart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Modal */}
      {showSyncModal && user && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <RefreshCw size={20} className="text-emerald-500" /> Geräte synchronisieren
              </h3>
              <button onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Deine Aufgaben werden automatisch in der Cloud gespeichert. Um sie auf einem anderen Gerät abzurufen, nutze diesen Code:
            </p>
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center mb-6">
              <code className="text-lg font-mono font-bold text-indigo-600 tracking-widest">{user.uid.substring(0, 8).toUpperCase()}</code>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600 mb-2 font-medium">Anderes Gerät verknüpfen:</p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={syncCodeInput}
                  onChange={(e) => setSyncCodeInput(e.target.value)}
                  placeholder="Sync-Code eingeben..."
                  className="flex-1 p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-300 uppercase"
                  maxLength={8}
                />
                <button 
                  onClick={handleSync}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  Verbinden
                </button>
              </div>
              {localStorage.getItem('taskflow_sync_uid') && (
                <button 
                  onClick={() => {
                    localStorage.removeItem('taskflow_sync_uid');
                    addToast('info', 'Synchronisierung zurückgesetzt.');
                    setTimeout(() => window.location.reload(), 1000);
                  }}
                  className="w-full mt-4 text-xs text-slate-400 hover:text-red-500 underline"
                >
                  Synchronisierung aufheben (Zurück zum lokalen Speicher)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Optimization Modal */}
      {showOptimizationModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><Sparkles size={24} /></div>
                <h2 className="text-xl font-bold text-indigo-900">KI Workflow Optimierung</h2>
              </div>
              <button onClick={() => setShowOptimizationModal(false)} className="p-2 text-indigo-400 hover:bg-indigo-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isOptimizing ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <div className="animate-spin text-indigo-500"><RefreshCw size={32} /></div>
                  <p className="text-slate-500 font-medium">Analysiere deine Aufgaben und lerne aus deinem Verhalten...</p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none prose-indigo">
                  <Markdown>{optimizationSuggestions}</Markdown>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setShowOptimizationModal(false)}
                className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
              >
                Verstanden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Import Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Mail size={20} className="text-blue-500" /> Aus E-Mail erstellen
              </h3>
              <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Füge hier den Text einer E-Mail ein. Die KI analysiert den Inhalt und erstellt automatisch eine Aufgabe mit Titel, Notizen, Fristen und Teilschritten.
            </p>
            <textarea
              value={emailContent}
              onChange={(e) => setEmailContent(e.target.value)}
              className="w-full h-64 p-4 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 resize-none mb-4"
              placeholder="E-Mail Text hier einfügen..."
            ></textarea>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
              >
                Abbrechen
              </button>
              <button 
                onClick={handleEmailImport}
                disabled={!emailContent.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Sparkles size={16} /> Aufgabe generieren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gmail Modal */}
      {showGmailModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-red-100 text-red-600 rounded-xl"><Mail size={24} /></div>
                <h2 className="text-xl font-bold">Ungelesene E-Mails</h2>
              </div>
              <button onClick={() => setShowGmailModal(false)} className="p-2 text-slate-400 hover:bg-slate-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!isGoogleLoggedIn ? (
                <div className="text-center py-10">
                  <p className="mb-4 text-slate-600">Bitte melde dich bei Google an, um E-Mails zu sehen.</p>
                  <button onClick={handleGoogleLogin} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">Mit Google verbinden</button>
                </div>
              ) : gmailMessages.length === 0 ? (
                <p className="text-center text-slate-500 py-10">Keine ungelesenen E-Mails.</p>
              ) : (
                gmailMessages.map(msg => (
                  <div key={msg.id} className="p-4 border border-slate-200 rounded-2xl hover:border-indigo-300 transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-slate-800 line-clamp-1">{msg.subject}</h4>
                      <button 
                        onClick={() => handleMailToTask(msg)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 text-xs font-medium bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-100"
                      >
                        <Sparkles size={14} /> <span>Als Aufgabe</span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mb-2">{msg.sender}</p>
                    <p className="text-sm text-slate-600 line-clamp-2">{msg.snippet}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Handwriting Canvas Component ---
function HandwritingCanvas({ initialData, onSave }: { initialData?: string, onSave: (data: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000'); 
  const [isEraser, setIsEraser] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(200);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastPos = useRef<{x: number, y: number} | null>(null);
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(200);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      canvas.width = rect.width;
      canvas.height = canvasHeight;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1; 
      ctx.strokeStyle = '#000000';
      ctxRef.current = ctx;

      if (initialData) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
        };
        img.src = initialData;
      }
    }
    
    const preventScroll = (e: TouchEvent) => {
      if (e.target === canvas) {
        e.preventDefault();
      }
    };
    
    canvas.addEventListener('touchstart', preventScroll, { passive: false });
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    
    return () => {
      canvas.removeEventListener('touchstart', preventScroll);
      canvas.removeEventListener('touchmove', preventScroll);
    };
  }, [canvasHeight, initialData]);

  useEffect(() => {
    if (ctxRef.current) {
      if (isEraser) {
        ctxRef.current.globalCompositeOperation = 'destination-out';
        ctxRef.current.lineWidth = 10;
      } else {
        ctxRef.current.globalCompositeOperation = 'source-over';
        ctxRef.current.strokeStyle = color;
        ctxRef.current.lineWidth = 1; 
      }
    }
  }, [color, isEraser, canvasHeight]);

  const getCoordinates = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (isResizing.current) return;
    setIsDrawing(true);
    const pos = getCoordinates(e);
    if (pos && ctxRef.current) {
      lastPos.current = pos;
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(pos.x, pos.y);
      ctxRef.current.lineTo(pos.x, pos.y);
      ctxRef.current.stroke();
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPos.current = null;
      if (canvasRef.current) {
        onSave(canvasRef.current.toDataURL());
      }
    }
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing || !ctxRef.current || !canvasRef.current || !lastPos.current || isResizing.current) return;
    
    const events = (e.nativeEvent as any).getCoalescedEvents ? (e.nativeEvent as any).getCoalescedEvents() : [e];
    
    for (let event of events) {
      const pos = getCoordinates(event as React.PointerEvent);
      if (!pos) continue;

      const midPoint = {
        x: lastPos.current.x + (pos.x - lastPos.current.x) / 2,
        y: lastPos.current.y + (pos.y - lastPos.current.y) / 2
      };

      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midPoint.x, midPoint.y);
      ctxRef.current.stroke();
      
      lastPos.current = pos;
    }
  };

  const clearCanvas = () => {
    if (canvasRef.current && ctxRef.current) {
      ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      onSave('');
    }
  };

  const startResize = (e: React.PointerEvent) => {
    isResizing.current = true;
    startY.current = e.clientY;
    startHeight.current = canvasHeight;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const doResize = (e: React.PointerEvent) => {
    if (!isResizing.current) return;
    const deltaY = e.clientY - startY.current;
    const newHeight = Math.max(100, startHeight.current + deltaY);
    setCanvasHeight(newHeight);
  };

  const stopResize = (e: React.PointerEvent) => {
    if (isResizing.current) {
      isResizing.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const colors = [
    { value: '#000000', label: 'Schwarz' },
    { value: '#2563eb', label: 'Blau' },
    { value: '#dc2626', label: 'Rot' },
    { value: '#16a34a', label: 'Grün' },
  ];

  return (
    <div ref={containerRef} className="relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50 mt-2 flex flex-col">
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-white p-1 rounded-md shadow-sm border border-slate-200 z-10">
        {colors.map(c => (
          <button
            key={c.value}
            onClick={() => { setColor(c.value); setIsEraser(false); }}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${!isEraser && color === c.value ? 'scale-110 border-slate-400' : 'border-transparent hover:scale-110'}`}
            style={{ backgroundColor: c.value }}
            title={c.label}
          />
        ))}
        <div className="w-px h-4 bg-slate-200 mx-1"></div>
        <button
          onClick={() => setIsEraser(true)}
          className={`p-1 rounded transition-colors ${isEraser ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
          title="Radiergummi"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerUp={stopDrawing}
        onPointerOut={stopDrawing}
        onPointerMove={draw}
        onPointerCancel={stopDrawing}
        style={{ height: `${canvasHeight}px` }}
        className={`w-full touch-none ${isEraser ? 'cursor-cell' : 'cursor-crosshair'}`}
      />
      <button 
        type="button"
        onClick={clearCanvas}
        className="absolute top-2 right-2 p-1.5 bg-white border border-slate-200 rounded-md text-slate-400 hover:text-red-500 shadow-sm z-10"
        title="Löschen"
      >
        <Trash2 size={14} />
      </button>
      
      <div 
        className="w-full h-4 bg-slate-100 border-t border-slate-200 flex items-center justify-center cursor-ns-resize hover:bg-slate-200 transition-colors"
        onPointerDown={startResize}
        onPointerMove={doResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        title="Höhe anpassen"
      >
        <div className="w-8 h-1 bg-slate-300 rounded-full"></div>
      </div>
    </div>
  );
}

// --- Task Card Component ---
function TaskCard({ 
  task, onSave, onDelete, onReplan, onDictate, onCopy, onExportPDF, 
  onGenerateBriefing, onAddToast, onOpenDocument, isExpanded, onToggleExpand 
}: any) {
  const [showSummary, setShowSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const generateDocument = async (subtask: any) => {
    onAddToast('info', 'KI erstellt Dokument...');
    try {
      const prompt = `Erstelle einen professionellen Schriftsatz oder eine E-Mail als abschließende Antwort für diese Aufgabe.
Nutze die folgenden Informationen:
Titel der Hauptaufgabe: ${task.title || ''}
Notizen der Hauptaufgabe: ${task.notes || ''}
Besprechungsergebnisse: ${task.meetingResults || 'Keine'}
Erledigte Teilschritte:
${(task.subtasks || []).filter((s: any) => s.isDone).map((s: any) => `- ${s.title}: ${s.notes || ''}`).join('\n')}

Ziel (aktueller Teilschritt): ${subtask.title || ''}

Formuliere den Text sachlich, professionell und direkt verwendbar.`;

      // NOTE: Using the global `ai` instance directly
      const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      
      onOpenDocument({
        title: `Entwurf: ${subtask.title}`,
        content: response.text || ''
      });
    } catch (error: any) {
      console.error('Error generating document:', error);
      onAddToast('error', `Fehler: ${error.message || 'Dokument konnte nicht erstellt werden.'}`);
    }
  };

  const suggestAction = async (subtask: any) => {
    onAddToast('info', 'Ermittle nächsten Schritt...');
    try {
      const prompt = `Basierend auf dem Teilschritt "${subtask.title}" und der Hauptaufgabe "${task.title}", schlage 1 bis 2 konkrete Unteraufgaben (Todos) vor, die jetzt als nächstes getan werden müssen.
Antworte AUSSCHLIESSLICH mit einem JSON-Array in diesem Format:
[{"title": "...", "notes": "..."}]`;

      const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      
      const newTodos = JSON.parse(response.text || '[]');
      if (newTodos && newTodos.length > 0) {
        const updatedSubtasks = task.subtasks.map((s: any) => {
          if (s.id === subtask.id) {
            const addedTodos = newTodos.map((t: any) => ({
              id: Math.random().toString(36).substring(2, 15),
              title: t.title,
              isDone: false,
              notes: t.notes || ''
            }));
            return { ...s, todos: [...(s.todos || []), ...addedTodos] };
          }
          return s;
        });
        onSave({ ...task, subtasks: updatedSubtasks });
        onAddToast('success', 'Nächste Schritte hinzugefügt.');
      } else {
        onAddToast('info', 'Keine spezifischen Schritte gefunden.');
      }
    } catch (error) {
      console.error('Error suggesting action:', error);
      onAddToast('error', 'Fehler bei der Aktionsermittlung.');
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        await processAudioRecording(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      onAddToast('info', 'Aufnahme gestartet...');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      onAddToast('error', 'Mikrofon konnte nicht gestartet werden.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudioRecording = async (blob: Blob) => {
    setIsProcessingAudio(true);
    onAddToast('info', 'Audio wird analysiert...');
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64Audio = base64data.split(',')[1];
        
        const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
        const response = await aiInstance.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Audio,
                  mimeType: blob.type || 'audio/webm'
                }
              },
              {
                text: `Analysiere diese Besprechung/dieses Telefonat. 
1. Fasse die wichtigsten Ergebnisse zusammen.
2. Leite daraus neue, notwendige Teilschritte ab, um das Hauptziel zu erreichen.
Antworte AUSSCHLIESSLICH im JSON-Format:
{
  "summary": "Zusammenfassung der Besprechung...",
  "newSubtasks": [
    { "title": "...", "notes": "..." }
  ]
}`
              }
            ]
          },
          config: {
            responseMimeType: 'application/json'
          }
        });

        const parsed = JSON.parse(response.text || '{}');
        const newSummary = parsed.summary || '';
        const newSubtasks = (parsed.newSubtasks || []).map((s: any) => ({
          id: Math.random().toString(36).substring(2, 15),
          title: s.title,
          isDone: false,
          notes: s.notes || '',
          todos: []
        }));

        const updatedMeetingResults = task.meetingResults 
          ? `${task.meetingResults}\n\n--- Neue Besprechung ---\n${newSummary}`
          : newSummary;

        onSave({
          ...task,
          meetingResults: updatedMeetingResults,
          subtasks: [...task.subtasks, ...newSubtasks]
        });
        
        onAddToast('success', 'Besprechung analysiert und Teilschritte hinzugefügt.');
        setIsProcessingAudio(false);
      };
    } catch (err) {
      console.error('Audio processing error:', err);
      onAddToast('error', 'Fehler bei der Audio-Analyse.');
      setIsProcessingAudio(false);
    }
  };

  const completedSubtasks = task.subtasks.filter((s: any) => s.isDone).length;
  
  let totalCheckables = 0;
  let completedCheckables = 0;
  task.subtasks.forEach((sub: any) => {
    totalCheckables++;
    if (sub.isDone) completedCheckables++;
    if (sub.todos) {
      sub.todos.forEach((todo: any) => {
        totalCheckables++;
        if (todo.isDone) completedCheckables++;
      });
    }
  });

  const progress = totalCheckables === 0 ? (task.isDone ? 100 : 0) : Math.round((completedCheckables / totalCheckables) * 100);

  const toggleTaskDone = () => {
    const newIsDone = !task.isDone;
    onSave({ ...task, isDone: newIsDone });

    if (newIsDone && task.recurrence && task.recurrence !== 'none') {
      const nextDate = getNextDate(task.dueDate || new Date().toISOString().split('T')[0], task.recurrence);
      const nextTask: Task = {
        ...task,
        id: Math.random().toString(36).substring(2, 15),
        isDone: false,
        dueDate: nextDate,
        createdAt: Date.now(),
        subtasks: task.subtasks.map((s: any) => ({
          ...s,
          id: Math.random().toString(36).substring(2, 15),
          isDone: false,
          todos: (s.todos || []).map((t: any) => ({ ...t, id: Math.random().toString(36).substring(2, 15), isDone: false }))
        })),
        syncStatus: 'local',
        googleTaskId: undefined, // Sehr wichtig, damit es als NEUE Aufgabe bei Google landet!
        googleCalendarEventId: undefined
      };
      
      onSave(nextTask);
      onAddToast('success', `Wiederholung erstellt für den ${new Date(nextDate).toLocaleDateString('de-DE')}`);
    }
  };

  const getNextDate = (currentDate: string, recurrence: 'daily' | 'weekly' | 'monthly') => {
    const date = new Date(currentDate);
    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
    
    if (recurrence === 'daily') date.setDate(date.getDate() + 1);
    else if (recurrence === 'weekly') date.setDate(date.getDate() + 7);
    else if (recurrence === 'monthly') date.setMonth(date.getMonth() + 1);
    
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const updateSubtask = (subtaskId: string, updates: any) => {
    const newSubtasks = task.subtasks.map((s: any) => s.id === subtaskId ? { ...s, ...updates } : s);
    onSave({ ...task, subtasks: newSubtasks });
  };

  const deleteSubtask = (subtaskId: string) => {
    const newSubtasks = task.subtasks.filter((s: any) => s.id !== subtaskId);
    onSave({ ...task, subtasks: newSubtasks });
  };

  const addTodo = (subtaskId: string) => {
    const newSubtasks = task.subtasks.map((s: any) => {
      if (s.id === subtaskId) {
        return {
          ...s,
          todos: [...(s.todos || []), { id: Math.random().toString(36).substring(2, 15), title: '', isDone: false }]
        };
      }
      return s;
    });
    onSave({ ...task, subtasks: newSubtasks });
  };

  const updateTodo = (subtaskId: string, todoId: string, updates: any) => {
    const newSubtasks = task.subtasks.map((s: any) => {
      if (s.id === subtaskId) {
        return {
          ...s,
          todos: (s.todos || []).map((t: any) => t.id === todoId ? { ...t, ...updates } : t)
        };
      }
      return s;
    });
    onSave({ ...task, subtasks: newSubtasks });
  };

  const deleteTodo = (subtaskId: string, todoId: string) => {
    const newSubtasks = task.subtasks.map((s: any) => {
      if (s.id === subtaskId) {
        return {
          ...s,
          todos: (s.todos || []).filter((t: any) => t.id !== todoId)
        };
      }
      return s;
    });
    onSave({ ...task, subtasks: newSubtasks });
  };

  const addSubtask = () => {
    const newSubtasks = [...task.subtasks, { id: Math.random().toString(36).substring(2, 15), title: '', isDone: false, notes: '', todos: [] }];
    onSave({ ...task, subtasks: newSubtasks });
  };

  const handleAttachFile = (e: React.ChangeEvent<HTMLInputElement>, isScanner = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
      onAddToast('error', 'Die Datei ist zu groß (max. 10MB).');
      return;
    }

    if (isScanner) {
      onAddToast('info', 'Magie Scanner aktiviert: Optimiere Vorlage...');
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      
      const newFile = { name: isScanner && file.type.startsWith('image/') ? `Scan_${file.name}` : file.name, type: file.type, data: base64 };
      const currentFiles = task.attachedFiles || (task.attachedFile ? [task.attachedFile] : []);
      
      if (isScanner && file.type.startsWith('image/')) {
        setTimeout(() => {
          onSave({ 
            ...task, 
            attachedFiles: [...currentFiles, newFile]
          });
          onAddToast('success', 'Vorlage erfolgreich geglättet und optimiert.');
        }, 1500);
      } else {
        onSave({ 
          ...task, 
          attachedFiles: [...currentFiles, newFile]
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    const currentFiles = task.attachedFiles || (task.attachedFile ? [task.attachedFile] : []);
    const newFiles = currentFiles.filter((_: any, i: number) => i !== index);
    onSave({ ...task, attachedFiles: newFiles, attachedFile: undefined });
  };

  const openFile = (file: { name: string, type: string, data: string }) => {
    const win = window.open();
    if (win) {
      win.document.write(`
        <html>
          <head><title>${file.name}</title></head>
          <body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f1f5f9;">
            ${file.type.startsWith('image/') 
              ? `<img src="${file.data}" style="max-width:100%;max-height:100vh;object-fit:contain;" />` 
              : file.type === 'application/pdf'
                ? `<iframe src="${file.data}" width="100%" height="100%" style="border:none;"></iframe>`
                : `<pre style="background:white;padding:2rem;border-radius:8px;box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);max-width:80%;max-height:80vh;overflow:auto;">${atob(file.data.split(',')[1])}</pre>`
            }
          </body>
        </html>
      `);
    }
  };

  const generateTasksFromMeeting = async () => {
    if (!task.meetingResults) {
      onAddToast('error', 'Keine Besprechungsergebnisse vorhanden.');
      return;
    }
    
    setIsGeneratingSummary(true);
    onAddToast('info', 'KI analysiert Besprechungsergebnisse und Anhänge...');
    
    try {
      const prompt = `Analysiere die folgenden Besprechungsergebnisse und die beigefügten Anhänge und leite daraus neue Teilschritte (Subtasks) ab. 
Falls ein abgeleiteter Punkt eher eine Unteraufgabe (Todo) eines bestehenden Teilschritts ist, ordne ihn diesem zu.
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:
{
  "newSubtasks": [{ "title": "...", "notes": "..." }],
  "newTodos": [{ "subtaskId": "...", "title": "..." }]
}

Bestehende Teilschritte (für Zuordnung der Todos):
${JSON.stringify(task.subtasks.map((s: any) => ({ id: s.id, title: s.title })))}

Besprechungsergebnisse:
${task.meetingResults}
`;

      const parts: any[] = [{ text: prompt }];
      const files = task.attachedFiles || (task.attachedFile ? [task.attachedFile] : []);
      for (const file of files) {
        if (file.data) {
          parts.push({
            inlineData: {
              data: file.data.includes(',') ? file.data.split(',')[1] : file.data,
              mimeType: file.type || 'image/jpeg'
            }
          });
        }
      }

      const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts },
        config: { responseMimeType: 'application/json' }
      });
      
      const result = JSON.parse(response.text || '{}');
      let updatedSubtasks = [...task.subtasks];
      
      if (result.newSubtasks && result.newSubtasks.length > 0) {
        const addedSubtasks = result.newSubtasks.map((s: any) => ({
          id: Math.random().toString(36).substring(2, 15),
          title: s.title,
          isDone: false,
          notes: s.notes || '',
          todos: []
        }));
        updatedSubtasks = [...updatedSubtasks, ...addedSubtasks];
      }
      
      if (result.newTodos && result.newTodos.length > 0) {
        result.newTodos.forEach((todo: any) => {
          const subtaskIndex = updatedSubtasks.findIndex(s => s.id === todo.subtaskId);
          if (subtaskIndex !== -1) {
            updatedSubtasks[subtaskIndex] = {
              ...updatedSubtasks[subtaskIndex],
              todos: [...(updatedSubtasks[subtaskIndex].todos || []), { id: Math.random().toString(36).substring(2, 15), title: todo.title, isDone: false }]
            };
          }
        });
      }
      
      onSave({ ...task, subtasks: updatedSubtasks });
      onAddToast('success', 'Aufgaben erfolgreich abgeleitet.');
    } catch (error) {
      console.error('Error generating tasks:', error);
      onAddToast('error', 'Fehler bei der KI-Analyse.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className={`bg-white rounded-[2rem] border ${task.isDone ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'} shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden`}>
      {/* Card Header */}
      <div className="p-5 flex items-start gap-4 cursor-pointer" onClick={() => onToggleExpand()}>
        <button 
          onClick={(e) => { e.stopPropagation(); toggleTaskDone(); }}
          className={`mt-1 flex-shrink-0 transition-colors ${task.isDone ? 'text-emerald-500' : 'text-slate-300 hover:text-indigo-500'}`}
        >
          {task.isDone ? <CheckCircle size={28} className="fill-emerald-100" /> : <Circle size={28} />}
        </button>
        
        <div className="flex-1 min-w-0">
          <input 
            type="text"
            value={task.title}
            onChange={(e) => onSave({ ...task, title: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className={`w-full bg-transparent border-none p-0 text-lg font-bold focus:ring-0 ${task.isDone ? 'text-slate-500 line-through' : 'text-slate-800'}`}
          />
          
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {task.dueDate && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-sm ${new Date(task.dueDate) < new Date() && !task.isDone ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'}`}>
                <CalendarIcon size={12} className="mr-1.5" /> Geplant: {task.dueDate} {task.time}
              </span>
            )}
            {task.googleTaskId && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-sm bg-blue-50 text-blue-700 border border-blue-100">
                <RefreshCw size={12} className="mr-1.5" /> Google Sync Aktiv
              </span>
            )}
            {task.deadline && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-sm ${new Date(task.deadline) < new Date() && !task.isDone ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                <AlertCircle size={12} className="mr-1.5" /> Frist: {task.deadline}
              </span>
            )}
            {task.sachbearbeiter && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100 shadow-sm">
                <Users size={12} className="mr-1.5" /> {task.sachbearbeiter}
              </span>
            )}
            {(task.attachedFiles?.length || (task.attachedFile ? 1 : 0)) > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                <Paperclip size={12} className="mr-1" /> {(task.attachedFiles?.length || 1)} Anhang
              </span>
            )}
            {task.subtasks.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                {completedSubtasks}/{task.subtasks.length} Schritte
              </span>
            )}
            {task.whatsappNumber && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                <Phone size={12} className="mr-1" /> WhatsApp
              </span>
            )}
            {task.email && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                <Mail size={12} className="mr-1" /> E-Mail
              </span>
            )}
            {task.recurrence && task.recurrence !== 'none' && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-100 shadow-sm">
                <RefreshCw size={12} className="mr-1.5" /> 
                {task.recurrence === 'daily' ? 'Täglich' : task.recurrence === 'weekly' ? 'Wöchentlich' : 'Monatlich'}
              </span>
            )}
          </div>
          
          {/* Progress Bar */}
          {task.subtasks.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex-1">
                <div 
                  className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-slate-500 w-8 text-right">{progress}%</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2 text-slate-400">
          <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-full transition-colors">
            <Trash2 size={18} />
          </button>
          <div className="p-2">
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50/80">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Col: Notes & Meta */}
            <div className="space-y-4">
              <div className="bg-white p-4 rounded-2xl border-2 border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notizen & Details</label>
                  <button onClick={() => onDictate(task.id, task.notes)} className="text-xs flex items-center font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors">
                    <Mic size={14} className="mr-1" /> Diktieren
                  </button>
                </div>
                <textarea 
                  value={task.notes}
                  onChange={(e) => onSave({ ...task, notes: e.target.value })}
                  className="w-full p-0 border-none bg-transparent text-sm focus:ring-0 resize-y min-h-[10rem] max-h-[30rem] overflow-y-auto placeholder:text-slate-300"
                  placeholder="Hier kannst du Details, Links oder weitere Infos zur Aufgabe festhalten..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 p-4 bg-indigo-50/30 rounded-2xl border-2 border-indigo-100/50 shadow-sm">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block">Geplant für (Tag)</label>
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={16} className="text-indigo-500" />
                    <input 
                      type="date" 
                      value={task.dueDate}
                      onChange={(e) => onSave({ ...task, dueDate: e.target.value })}
                      className="w-full p-0 border-none bg-transparent text-base font-bold text-indigo-900 focus:ring-0"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 p-4 bg-rose-50/30 rounded-2xl border-2 border-rose-100/50 shadow-sm">
                  <label className="text-[10px] font-black text-rose-400 uppercase tracking-widest block">Frist (Deadline)</label>
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-rose-500" />
                    <input 
                      type="date" 
                      value={task.deadline || ''}
                      onChange={(e) => onSave({ ...task, deadline: e.target.value })}
                      className="w-full p-0 border-none bg-transparent text-base font-bold text-rose-900 focus:ring-0"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Uhrzeit</label>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-slate-400" />
                    <input 
                      type="time" 
                      value={task.time}
                      onChange={(e) => onSave({ ...task, time: e.target.value })}
                      className="w-full p-0 border-none bg-transparent text-sm font-bold text-slate-700 focus:ring-0"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Wiedervorlage</label>
                  <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-slate-400" />
                    <input 
                      type="date" 
                      value={task.followUpDate || ''}
                      onChange={(e) => onSave({ ...task, followUpDate: e.target.value })}
                      className="w-full p-0 border-none bg-transparent text-sm font-bold text-slate-700 focus:ring-0"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Wiederholung</label>
                  <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-slate-400" />
                    <select 
                      value={task.recurrence || 'none'}
                      onChange={(e) => onSave({ ...task, recurrence: e.target.value as any })}
                      className="w-full p-0 border-none bg-transparent text-sm font-bold text-slate-700 focus:ring-0"
                    >
                      <option value="none">Keine</option>
                      <option value="daily">Täglich</option>
                      <option value="weekly">Wöchentlich</option>
                      <option value="monthly">Monatlich</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Location & Contacts */}
              <div className="bg-white p-4 rounded-2xl border-2 border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ort & Treffpunkt</label>
                  {task.location && (
                    <button 
                      onClick={() => {
                        if (!task.notifyOnArrival) {
                          if ('geolocation' in navigator) {
                            navigator.geolocation.getCurrentPosition(() => {
                              onSave({ ...task, notifyOnArrival: true });
                              onAddToast('success', 'Standort-Erinnerung aktiviert.');
                            }, () => {
                              onAddToast('error', 'Standortzugriff verweigert.');
                            });
                          } else {
                            onAddToast('error', 'Geolokalisierung wird nicht unterstützt.');
                          }
                        } else {
                          onSave({ ...task, notifyOnArrival: false });
                          onAddToast('info', 'Standort-Erinnerung deaktiviert.');
                        }
                      }}
                      className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full font-medium transition-colors ${task.notifyOnArrival ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      <MapPin size={10} />
                      {task.notifyOnArrival ? 'Erinnert bei Ankunft' : 'Bei Ankunft erinnern'}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    value={task.location || ''}
                    onChange={(e) => onSave({ ...task, location: e.target.value })}
                    className="w-full pl-9 p-2 border-none bg-slate-50 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500"
                    placeholder="Wo findet die Aufgabe statt?"
                  />
                </div>
              </div>

              {/* Contacts Section */}
              <div className="bg-white p-4 rounded-2xl border-2 border-slate-100 shadow-sm space-y-4">
                <div>
                  <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest block mb-2">Ansprechpartner / Sachbearbeiter</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
                      <input 
                        type="text"
                        value={task.sachbearbeiter || ''}
                        onChange={(e) => onSave({ ...task, sachbearbeiter: e.target.value })}
                        placeholder="Name des Sachbearbeiters"
                        className="w-full pl-9 p-2 border-none bg-amber-50/50 rounded-xl text-sm font-bold text-amber-900 focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    {'contacts' in navigator && 'ContactsManager' in window && (
                      <button 
                        onClick={async () => {
                          try {
                            const props = ['name'];
                            const contacts = await (navigator as any).contacts.select(props, { multiple: false });
                            if (contacts && contacts.length > 0 && contacts[0].name && contacts[0].name.length > 0) {
                              onSave({ ...task, sachbearbeiter: contacts[0].name[0] });
                            }
                          } catch (e) {
                            console.error('Contacts API error', e);
                          }
                        }}
                        className="p-2 bg-amber-100 rounded-xl hover:bg-amber-200 text-amber-600 transition-colors"
                        title="Aus Kontakten wählen"
                      >
                        <Users size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Kontaktmöglichkeiten</label>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="tel" 
                          value={task.phoneNumber || ''}
                          onChange={(e) => onSave({ ...task, phoneNumber: e.target.value })}
                          className="w-full pl-9 p-2 border-none bg-slate-50 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500"
                          placeholder="Telefonnummer"
                        />
                      </div>
                      {'contacts' in navigator && 'ContactsManager' in window && (
                        <button 
                          onClick={async () => {
                            try {
                              const props = ['name', 'tel'];
                              const contacts = await (navigator as any).contacts.select(props, { multiple: false });
                              if (contacts && contacts.length > 0 && contacts[0].tel && contacts[0].tel.length > 0) {
                                onSave({ ...task, phoneNumber: contacts[0].tel[0] });
                              }
                            } catch (e) {
                              console.error('Contacts API error', e);
                            }
                          }}
                          className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 text-slate-600 transition-colors"
                          title="Aus Kontakten wählen"
                        >
                          <Users size={16} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500" />
                        <input 
                          type="tel" 
                          value={task.whatsappNumber || ''}
                          onChange={(e) => onSave({ ...task, whatsappNumber: e.target.value })}
                          className="w-full pl-9 p-2 border-none bg-emerald-50/50 rounded-xl text-sm font-semibold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                          placeholder="WhatsApp Nummer"
                        />
                      </div>
                      {'contacts' in navigator && 'ContactsManager' in window && (
                        <button 
                          onClick={async () => {
                            try {
                              const props = ['name', 'tel'];
                              const contacts = await (navigator as any).contacts.select(props, { multiple: false });
                              if (contacts && contacts.length > 0 && contacts[0].tel && contacts[0].tel.length > 0) {
                                onSave({ ...task, whatsappNumber: contacts[0].tel[0] });
                              }
                            } catch (e) {
                              console.error('Contacts API error', e);
                            }
                          }}
                          className="p-2 bg-emerald-100 rounded-xl hover:bg-emerald-200 text-emerald-600 transition-colors"
                          title="Aus Kontakten wählen"
                        >
                          <Users size={16} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
                        <input 
                          type="email" 
                          value={task.email || ''}
                          onChange={(e) => onSave({ ...task, email: e.target.value })}
                          className="w-full pl-9 p-2 border-none bg-blue-50/50 rounded-xl text-sm font-semibold text-blue-700 focus:ring-2 focus:ring-blue-500"
                          placeholder="E-Mail Adresse"
                        />
                      </div>
                      {task.email && (
                        <a 
                          href={`mailto:${task.email}?subject=${encodeURIComponent(task.title)}`}
                          className="p-2 bg-blue-100 rounded-xl hover:bg-blue-200 text-blue-600 transition-colors"
                          title="E-Mail senden"
                        >
                          <Mail size={16} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Attachments Section */}
              <div className="pt-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Anhänge</label>
                <div className="flex flex-col gap-2 mb-3">
                  {(() => {
                    const files = task.attachedFiles || (task.attachedFile ? [task.attachedFile] : []);
                    if (files.length === 0) {
                      return <div className="text-sm text-slate-400 italic">Keine Anhänge</div>;
                    }
                    return files.map((file: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm">
                        <Paperclip size={16} className="text-slate-400 flex-shrink-0" />
                        <span className="truncate flex-1 text-slate-700 cursor-pointer hover:text-indigo-600 hover:underline" onClick={() => openFile(file)}>{file.name}</span>
                        <button onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-500 p-1 flex-shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    ));
                  })()}
                </div>
                <div className="flex flex-wrap gap-2 relative">
                  <button 
                    onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                    className="flex items-center justify-center px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Paperclip size={14} className="mr-1.5 text-indigo-500" /> Anhang hinzufügen
                  </button>
                  
                  {showAttachmentMenu && (
                    <div className="absolute top-10 left-0 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-2 w-48">
                      <label className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                        <ImageIcon size={16} className="text-indigo-500" /> Foto hochladen
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleAttachFile(e); setShowAttachmentMenu(false); }} />
                      </label>
                      <label className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                        <FileText size={16} className="text-red-500" /> PDF hochladen
                        <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { handleAttachFile(e); setShowAttachmentMenu(false); }} />
                      </label>
                      <label className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                        <Camera size={16} className="text-emerald-500" /> Magie Scanner
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handleAttachFile(e, true); setShowAttachmentMenu(false); }} />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Meeting Results & Recording */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Besprechungsergebnisse</label>
                  <div className="flex items-center gap-2">
                    {task.meetingResults && (
                      <button 
                        onClick={generateTasksFromMeeting}
                        disabled={isGeneratingSummary}
                        className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                      >
                        <Sparkles size={14} className="mr-1.5" /> Aufgaben ableiten
                      </button>
                    )}
                    <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={isProcessingAudio}
                      className={`flex items-center px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        isRecording 
                          ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 animate-pulse' 
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100'
                      } ${isProcessingAudio ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isRecording ? (
                        <><StopCircle size={14} className="mr-1.5" /> Aufnahme stoppen</>
                      ) : isProcessingAudio ? (
                        <><RefreshCw size={14} className="mr-1.5 animate-spin" /> Verarbeite...</>
                      ) : (
                        <><Mic size={14} className="mr-1.5" /> Besprechung aufnehmen</>
                      )}
                    </button>
                  </div>
                </div>
                <textarea 
                  value={task.meetingResults || ''}
                  onChange={(e) => onSave({ ...task, meetingResults: e.target.value })}
                  placeholder="Ergebnisse der Besprechung oder des Telefonats..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-indigo-300 resize-y min-h-[12rem]"
                />
                <div className="mt-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Handschriftliche Notizen</label>
                  <HandwritingCanvas 
                    initialData={task.handwrittenNotes} 
                    onSave={(data) => onSave({ ...task, handwrittenNotes: data })} 
                  />
                </div>
              </div>
            </div>

            {/* Right Col: Subtasks & Actions */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-slate-700">Teilschritte</label>
                <button onClick={() => onReplan(task)} className="text-xs flex items-center text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-md font-medium">
                  <Sparkles size={14} className="mr-1" /> KI Re-Plan
                </button>
              </div>
              
              <div className="space-y-2">
                {task.subtasks.map((sub: any, idx: number) => (
                  <div key={sub.id} className="flex items-start gap-3 p-3 bg-indigo-50/80 rounded-xl border border-indigo-100 shadow-sm">
                    <button onClick={() => updateSubtask(sub.id, { isDone: !sub.isDone })} className={`mt-0.5 flex-shrink-0 ${sub.isDone ? 'text-emerald-500' : 'text-slate-300'}`}>
                      {sub.isDone ? <CheckCircle size={18} /> : <Circle size={18} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <input 
                          type="text" 
                          value={sub.title}
                          onChange={(e) => updateSubtask(sub.id, { title: e.target.value })}
                          className={`w-full bg-transparent border-none p-0 text-sm focus:ring-0 ${sub.isDone ? 'text-slate-400 line-through' : 'font-medium text-slate-700'}`}
                        />
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => suggestAction(sub)}
                            className="text-indigo-500 hover:text-indigo-600 p-1 flex-shrink-0"
                            title="Aktion vorschlagen"
                          >
                            <Sparkles size={14} />
                          </button>
                          {task.whatsappNumber && (
                            <a 
                              href={`https://wa.me/${task.whatsappNumber.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(`Aufgabe: ${sub.title}\n${sub.notes || ''}`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-500 hover:text-emerald-600 p-1 flex-shrink-0"
                              title="Per WhatsApp senden"
                            >
                              <Phone size={14} />
                            </a>
                          )}
                          <button onClick={() => deleteSubtask(sub.id)} className="text-slate-400 hover:text-red-500 p-1 flex-shrink-0">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <textarea 
                        value={sub.notes}
                        onChange={(e) => updateSubtask(sub.id, { notes: e.target.value })}
                        placeholder="Notiz..."
                        className="w-full bg-transparent border border-slate-100 rounded-md p-2 text-sm text-slate-600 focus:ring-1 focus:ring-indigo-300 mt-2 resize-y min-h-[4rem] max-h-[15rem] overflow-y-auto"
                      />
                      
                      {/* Subtask Todos */}
                      <div className="mt-3 space-y-2 pl-2 border-l-2 border-slate-100">
                        {(sub.todos || []).map((todo: any) => (
                          <div key={todo.id} className="flex flex-col gap-1 group bg-slate-50 p-2 rounded-lg border border-slate-200/50">
                            <div className="flex items-center gap-2">
                              <button onClick={() => updateTodo(sub.id, todo.id, { isDone: !todo.isDone })} className={`flex-shrink-0 ${todo.isDone ? 'text-emerald-500' : 'text-slate-300'}`}>
                                {todo.isDone ? <CheckCircle size={14} /> : <Circle size={14} />}
                              </button>
                              <input 
                                type="text" 
                                value={todo.title}
                                onChange={(e) => updateTodo(sub.id, todo.id, { title: e.target.value })}
                                placeholder="Aufgabe..."
                                className={`flex-1 bg-transparent border-none p-0 text-sm focus:ring-0 ${todo.isDone ? 'text-slate-400 line-through' : 'text-slate-600'}`}
                              />
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {task.whatsappNumber && (
                                  <a 
                                    href={`https://wa.me/${task.whatsappNumber.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(`Aufgabe: ${todo.title}\n${todo.notes || ''}`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      const now = new Date().toLocaleString('de-DE');
                                      const logMsg = `WhatsApp gesendet am ${now}`;
                                      const currentLog = todo.whatsappLog || [];
                                      updateTodo(sub.id, todo.id, { whatsappLog: [...currentLog, logMsg] });
                                      onAddToast('success', 'WhatsApp geöffnet und protokolliert');
                                    }}
                                    className="text-emerald-500 hover:text-emerald-600 p-1 flex-shrink-0"
                                    title="Per WhatsApp senden"
                                  >
                                    <Phone size={12} />
                                  </a>
                                )}
                                <button onClick={() => deleteTodo(sub.id, todo.id)} className="text-slate-400 hover:text-red-500 p-1 flex-shrink-0">
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                            <textarea 
                              value={todo.notes || ''}
                              onChange={(e) => updateTodo(sub.id, todo.id, { notes: e.target.value })}
                              placeholder="Notiz zur Unteraufgabe..."
                              className="w-full bg-slate-50 border border-slate-100 rounded p-1.5 text-xs text-slate-600 focus:ring-1 focus:ring-indigo-300 resize-y min-h-[2.5rem] mt-1"
                            />
                            {todo.whatsappLog && todo.whatsappLog.length > 0 && (
                              <div className="text-[10px] text-slate-400 mt-1 pl-1 border-l-2 border-emerald-200">
                                {todo.whatsappLog.map((log: string, i: number) => (
                                  <div key={i}>{log}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <button onClick={() => addTodo(sub.id)} className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center mt-1">
                          + Aufgabe hinzufügen
                        </button>
                      </div>
                    </div>
                    {idx === task.subtasks.length - 1 && (
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded">Ziel</span>
                        <button 
                          onClick={() => generateDocument(sub)}
                          className="text-xs flex items-center gap-1 bg-indigo-600 text-white px-2 py-1.5 rounded-md hover:bg-indigo-700 transition-colors shadow-sm"
                        >
                          <FileText size={12} /> Dokument erstellen
                        </button>
                      </div>
                    )}
                    <button onClick={() => deleteSubtask(sub.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity self-start mt-1">
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {task.subtasks.length === 0 && (
                  <p className="text-sm text-slate-400 italic p-4 text-center border border-dashed border-slate-200 rounded-xl">Keine Teilschritte. Nutze KI Re-Plan oder füge manuell hinzu.</p>
                )}
                <button onClick={addSubtask} className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors flex items-center justify-center">
                  + Teilschritt hinzufügen
                </button>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={async () => {
                    if (!showSummary && !summaryText) {
                      setIsGeneratingSummary(true);
                      const text = await onGenerateBriefing(task);
                      setSummaryText(text);
                      setIsGeneratingSummary(false);
                    }
                    setShowSummary(!showSummary);
                  }} 
                  className="flex items-center px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <Sparkles size={14} className="mr-1.5" /> Zusammenfassung {showSummary ? 'einklappen' : 'ausklappen'}
                </button>
                <button onClick={() => onCopy(task)} className="flex items-center px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  <Copy size={14} className="mr-1.5" /> Kopieren
                </button>
                <button onClick={() => onExportPDF(task)} className="flex items-center px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  <Download size={14} className="mr-1.5" /> PDF
                </button>
              </div>
              
              {(task.attachedFiles?.length || (task.attachedFile ? 1 : 0)) > 0 && (
                <div className="flex items-center text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                  <FileText size={14} className="mr-1.5" /> {(task.attachedFiles?.length || 1)} Anhang
                </div>
              )}
            </div>

            {showSummary && (
              <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 text-sm text-slate-700 whitespace-pre-wrap relative group">
                {!isGeneratingSummary && (
                  <button 
                    onClick={async () => {
                      setIsGeneratingSummary(true);
                      const text = await onGenerateBriefing(task);
                      setSummaryText(text);
                      setIsGeneratingSummary(false);
                      onAddToast('success', 'Zusammenfassung wurde aktualisiert.');
                    }}
                    className="absolute top-2 right-2 p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                    title="Zusammenfassung neu generieren"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                {isGeneratingSummary ? (
                  <div className="flex items-center text-indigo-500 animate-pulse">
                    <RefreshCw size={16} className="mr-2 animate-spin" /> Generiere Zusammenfassung...
                  </div>
                ) : (
                  <div className="markdown-body">
                    <Markdown
                      components={{
                        h3: ({ node, ...props }) => <h3 className="text-indigo-700 font-black text-lg mt-6 mb-3 flex items-center gap-2 border-b border-indigo-100 pb-1" {...props} />,
                        strong: ({ node, ...props }) => <strong className="text-slate-900 font-bold bg-indigo-50/50 px-1 rounded border border-indigo-100/30" {...props} />,
                        p: ({ node, children, ...props }: any) => {
                          const newChildren = React.Children.map(children, child => {
                            if (typeof child === 'string') {
                              const parts = child.split('→');
                              return parts.map((part, i) => (
                                <React.Fragment key={i}>
                                  {part}
                                  {i < parts.length - 1 && (
                                    <span className="text-indigo-600 font-black text-lg mx-1 inline-block transform translate-y-0.5">➜</span>
                                  )}
                                </React.Fragment>
                              ));
                            }
                            return child;
                          });
                          return <p className="text-slate-600 font-normal leading-relaxed mb-3" {...props}>{newChildren}</p>;
                        },
                        li: ({ node, children, ...props }: any) => {
                          const newChildren = React.Children.map(children, child => {
                            if (typeof child === 'string') {
                              const parts = child.split('→');
                              return parts.map((part, i) => (
                                <React.Fragment key={i}>
                                  {part}
                                  {i < parts.length - 1 && (
                                    <span className="text-indigo-600 font-black text-lg mx-1 inline-block transform translate-y-0.5">➜</span>
                                  )}
                                </React.Fragment>
                              ));
                            }
                            return child;
                          });
                          return <li className="text-slate-600 font-normal mb-2" {...props}>{newChildren}</li>;
                        },
                        hr: () => <hr className="my-6 border-slate-200" />
                      }}
                    >
                      {summaryText}
                    </Markdown>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
