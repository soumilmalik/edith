import React, { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppState } from "../state/appState.js";
import { auth, listTasks, addTask, updateTask, deleteTask, rolloverTasksIfNewDay } from "../lib/firebase.js";
import { prioritizeTask } from "../lib/tasks.js";
import { sortByOrder, computeInsertOrder, computeDragOrder } from "../lib/taskOrder.js";
import { startScribeStream } from "../lib/scribeStream.js";
import { IconMic, IconTrash, IconCheck } from "./SmallIcons.jsx";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const MIC_SUPPORTED = !!navigator.mediaDevices?.getUserMedia && "WebSocket" in window;

export default function TaskList() {
  const { user, domains, tasksVersion } = useAppState();
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [listening, setListening] = useState(false);

  const scribeRef = useRef(null);
  const committedRef = useRef("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Once-per-day cleanup: completed tasks from a previous day are
      // cleared out here before the list loads - unticked ones are never
      // touched, which is what carries them forward automatically.
      await rolloverTasksIfNewDay(user.uid);
      const list = await listTasks(user.uid);
      if (!cancelled) {
        setTasks(sortByOrder(list));
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tasksVersion: bumped whenever add_task runs from chat/voice.
  }, [user, tasksVersion]);

  useEffect(() => () => scribeRef.current?.stop(), []);

  async function handleAdd(e) {
    e?.preventDefault();
    const title = newTitle.trim();
    if (!title || !user) return;
    setAdding(true);
    setTaskError("");
    try {
      const { priority, domain } = await prioritizeTask({
        title,
        domains,
        existingTasks: tasks.map((t) => ({ title: t.title, priority: t.priority })),
      });
      const order = computeInsertOrder(tasks, priority);
      const id = await addTask(user.uid, { title, domain: domain || null, priority, order, done: false });
      setTasks((ts) => sortByOrder([...ts, { id, title, domain, priority, order, done: false }]));
      setNewTitle("");
    } catch (err) {
      setTaskError(err.message || "Couldn't add that task.");
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(task) {
    const done = !task.done;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done } : t)));
    await updateTask(user.uid, task.id, { done });
  }

  async function handleDelete(task) {
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    await deleteTask(user.uid, task.id);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tasks, oldIndex, newIndex);
    const order = computeDragOrder(reordered, newIndex);
    reordered[newIndex] = { ...reordered[newIndex], order };
    setTasks(reordered);
    updateTask(user.uid, reordered[newIndex].id, { order });
  }

  async function toggleMic() {
    if (listening) {
      scribeRef.current?.stop();
      return;
    }
    setTaskError("");
    committedRef.current = "";
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const controller = await startScribeStream({
        workerUrl: WORKER_URL,
        idToken,
        onOpen: () => setListening(true),
        onCommitted: (text) => {
          committedRef.current = `${committedRef.current} ${text}`.trim();
        },
        onError: () => setTaskError("Voice input hit an error - check your connection and try again."),
        onClose: () => {
          setListening(false);
          scribeRef.current = null;
          const heard = committedRef.current.trim();
          if (heard) setNewTitle((t) => (t.trim() ? `${t.trim()} ${heard}` : heard));
        },
      });
      scribeRef.current = controller;
    } catch (err) {
      setTaskError(err.message || "Couldn't start voice input.");
    }
  }

  const sensors = useSensors(
    // A short press-and-hold before a drag activates, so a plain tap on the
    // checkbox/delete button (or on the row to just read it) never gets
    // mistaken for the start of a reorder.
    useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  return (
    <div className="panel">
      <div className="section-title">Tasks</div>

      <form className="row wrap" style={{ marginBottom: 8 }} onSubmit={handleAdd}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task, or dictate it..."
          style={{ flex: 1 }}
          disabled={adding}
        />
        {MIC_SUPPORTED && (
          <button
            type="button"
            className={`round-btn mic-btn ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            title="Dictate a task"
          >
            <IconMic width={16} height={16} style={{ margin: 0 }} />
          </button>
        )}
        <button type="submit" disabled={adding || !newTitle.trim()}>
          {adding ? "..." : "Add"}
        </button>
      </form>

      {taskError && (
        <div className="small" style={{ color: "var(--danger)", marginBottom: 6 }}>
          {taskError}
        </div>
      )}

      {loaded && tasks.length === 0 && (
        <div className="small" style={{ color: "var(--text-dim)" }}>
          No tasks yet - add one above and Edith will prioritize it.
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="task-list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={toggleDone} onDelete={handleDelete} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const priority = task.priority || 3;

  return (
    <div ref={setNodeRef} style={style} className={`task-row ${task.done ? "done" : ""} ${isDragging ? "dragging" : ""}`}>
      <button type="button" className={`task-check ${task.done ? "checked" : ""}`} onClick={() => onToggle(task)}>
        {task.done && <IconCheck width={12} height={12} style={{ margin: 0 }} />}
      </button>
      <div className="task-drag-handle" {...attributes} {...listeners}>
        <span className="task-title">{task.title}</span>
        {task.domain && <span className="badge">{task.domain}</span>}
      </div>
      <span className={`task-priority p${priority}`}>{priority}</span>
      <button type="button" className="task-delete" title="Delete task" onClick={() => onDelete(task)}>
        <IconTrash width={13} height={13} style={{ margin: 0 }} />
      </button>
    </div>
  );
}
