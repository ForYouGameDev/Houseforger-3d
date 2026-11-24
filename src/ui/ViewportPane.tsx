import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Vec3 } from '../core/project';
import type { EditorState, EditorStore, Tool, ViewName } from '../editor/store';
import { Viewport, type AxisInfo } from '../render/viewport';

export interface ViewportApi {
  getGroundTarget(): Vec3;
  frame(): void;
  /** factor < 1 zooms in, factor > 1 zooms out. */
  zoomBy(factor: number): void;
}

interface Props {
  store: EditorStore;
  state: EditorState;
  apiRef: MutableRefObject<ViewportApi | null>;
}

const AXIS_COLORS: Record<AxisInfo['axis'], string> = { x: '#e5534b', y: '#7bc67b', z: '#4c8dd6' };
const AXIS_VIEW: Record<AxisInfo['axis'], [ViewName, ViewName]> = {
  x: ['right', 'left'],
  y: ['top', 'bottom'],
  z: ['front', 'back'],
};

const TOOLS: { id: Tool; label: string; key: string; icon: string; hint: string }[] = [
  { id: 'hand', label: 'Hand', key: 'Q', icon: '✋', hint: 'Drag to move the camera sideways' },
  { id: 'move', label: 'Move', key: 'W', icon: '✥', hint: 'Move the selected part' },
  { id: 'rotate', label: 'Rotate', key: 'E', icon: '⟳', hint: 'Rotate the selected part' },
  { id: 'scale', label: 'Scale', key: 'R', icon: '⤢', hint: 'Resize the selected part' },
];

/** A button that zooms once when pressed and keeps zooming while it is held down (works with touch). */
function HoldButton({
  label,
  onTap,
  onHold,
  children,
}: {
  label: string;
  onTap(): void;
  onHold(): void;
  children: ReactNode;
}) {
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (delay.current !== null) clearTimeout(delay.current);
    if (repeat.current !== null) clearInterval(repeat.current);
    delay.current = null;
    repeat.current = null;
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className="btn zoom-btn"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        stop();
        onTap();
        delay.current = setTimeout(() => {
          repeat.current = setInterval(onHold, 60);
        }, 350);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap();
        }
      }}
    >
      {children}
    </button>
  );
}

export function ViewportPane({ store, state, apiRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [axes, setAxes] = useState<AxisInfo[]>([]);
  const lastEpoch = useRef(state.projectEpoch);

  const project = state.history.present;
  const { selection, settings, tool } = state;

  // Create and dispose the renderer with the component.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let vp: Viewport;
    try {
      vp = new Viewport(host, {
        onPick: (id, additive) => store.pick(id, additive),
        onTransform: (id, t) => store.setTransform(id, t),
        onOrientation: setAxes,
        onProblem: (m) => store.error(m),
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The 3D view could not start.');
      return;
    }
    setProblem(null);
    vpRef.current = vp;
    apiRef.current = {
      getGroundTarget: () => vp.getGroundTarget(),
      frame: () => vp.frame(),
      zoomBy: (f) => vp.zoomBy(f),
    };

    const s = store.getState();
    vp.setProject(s.history.present);
    vp.setSelection(s.selection);
    vp.setGridVisible(s.settings.showGrid);
    vp.setProjection(s.settings.orthographic ? 'orthographic' : 'perspective');
    vp.setSnap(s.settings.snap);
    vp.setTool(s.tool);
    vp.frame([]);

    return () => {
      vp.dispose();
      vpRef.current = null;
      apiRef.current = null;
    };
  }, [store, apiRef, attempt]);

  useEffect(() => {
    vpRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    vpRef.current?.setSelection(selection);
  }, [selection, project]);

  useEffect(() => {
    vpRef.current?.setGridVisible(settings.showGrid);
  }, [settings.showGrid]);

  useEffect(() => {
    vpRef.current?.setProjection(settings.orthographic ? 'orthographic' : 'perspective');
  }, [settings.orthographic]);

  useEffect(() => {
    vpRef.current?.setSnap(settings.snap);
  }, [settings.snap]);

  useEffect(() => {
    vpRef.current?.setTool(tool);
  }, [tool]);

  // A new/opened project is re-framed once.
  useEffect(() => {
    if (lastEpoch.current !== state.projectEpoch) {
      lastEpoch.current = state.projectEpoch;
      vpRef.current?.frame([]);
    }
  }, [state.projectEpoch]);

  if (problem) {
    return (
      <div className="viewport viewport-problem" role="alert">
        <h2>3D view unavailable</h2>
        <p>{problem}</p>
        <p className="hint">Try updating your browser or graphics drivers. Your project is safe and still saves normally.</p>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  const sorted = [...axes].sort((a, b) => a.depth - b.depth);

  return (
    <div className="viewport">
      <div className="scene-header" role="toolbar" aria-label="Scene tools">
        <span className="scene-title">Scene</span>

        <div className="btn-group" role="group" aria-label="Transform tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn tool-btn ${tool === t.id ? 'active' : ''}`}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key}): ${t.hint}`}
              onClick={() => store.setTool(t.id)}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span className="label"> {t.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`btn ${settings.snap ? 'active' : ''}`}
          aria-pressed={settings.snap}
          title="Snap moving, rotating and scaling to neat steps (0.25 m, 15°, 0.1)"
          onClick={() => store.setSettings({ snap: !settings.snap })}
        >
          Snap
        </button>

        <span className="spacer" />

        <button type="button" className="btn" onClick={() => vpRef.current?.frame()} title="Zoom to the selected part, or to everything (F)">
          Frame
        </button>
        <button type="button" className="btn" onClick={() => vpRef.current?.resetView()} title="Back to the default camera angle">
          Reset
        </button>
        <label className="select-wrap" title="Look from a standard direction">
          <span className="sr-only">Standard view</span>
          <select
            value=""
            aria-label="Standard view"
            onChange={(e) => {
              if (e.target.value) vpRef.current?.setView(e.target.value as ViewName);
            }}
          >
            <option value="">View…</option>
            <option value="front">Front</option>
            <option value="back">Back</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <button
          type="button"
          className={`btn ${settings.orthographic ? 'active' : ''}`}
          aria-pressed={settings.orthographic}
          onClick={() => store.setSettings({ orthographic: !settings.orthographic })}
          title="Switch between perspective and flat (orthographic) camera"
        >
          {settings.orthographic ? 'Iso' : 'Persp'}
        </button>
      </div>

      <div className="viewport-stage">
        <div className="viewport-host" ref={hostRef} />

        <div className="zoom-controls" role="group" aria-label="Zoom">
          <HoldButton label="Zoom in" onTap={() => apiRef.current?.zoomBy(0.8)} onHold={() => apiRef.current?.zoomBy(0.96)}>
            +
          </HoldButton>
          <HoldButton label="Zoom out" onTap={() => apiRef.current?.zoomBy(1.25)} onHold={() => apiRef.current?.zoomBy(1.04)}>
            −
          </HoldButton>
          <button type="button" className="btn zoom-btn" aria-label="Zoom to fit" title="Zoom to fit (F)" onClick={() => vpRef.current?.frame()}>
            ⤧
          </button>
        </div>

        {axes.length > 0 ? (
          <svg className="gizmo" viewBox="-50 -50 100 100" role="group" aria-label="Orientation gizmo. Click an axis to look from it.">
            {sorted.map((a) => {
              const cx = a.x * 32;
              const cy = -a.y * 32;
              const view = AXIS_VIEW[a.axis][a.negative ? 1 : 0];
              const go = () => vpRef.current?.setView(view);
              return (
                <g
                  key={`${a.axis}${a.negative ? '-' : '+'}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Look from ${view}`}
                  className="gizmo-axis"
                  onClick={go}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      go();
                    }
                  }}
                >
                  {!a.negative ? <line x1={0} y1={0} x2={cx} y2={cy} stroke={AXIS_COLORS[a.axis]} strokeWidth={3} /> : null}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={a.negative ? 7 : 11}
                    fill={a.negative ? '#2b3038' : AXIS_COLORS[a.axis]}
                    stroke={AXIS_COLORS[a.axis]}
                    strokeWidth={2}
                    opacity={a.depth >= 0 ? 1 : 0.6}
                  />
                  {!a.negative ? (
                    <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#10131a">
                      {a.axis.toUpperCase()}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}
