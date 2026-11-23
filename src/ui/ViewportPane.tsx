import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Vec3 } from '../core/project';
import type { EditorState, EditorStore, ViewName } from '../editor/store';
import { Viewport, type AxisInfo } from '../render/viewport';

export interface ViewportApi {
  getGroundTarget(): Vec3;
  frame(): void;
}

interface Props {
  store: EditorStore;
  state: EditorState;
  apiRef: MutableRefObject<ViewportApi | null>;
}

const AXIS_COLORS: Record<AxisInfo['axis'], string> = { x: '#ef5350', y: '#66bb6a', z: '#42a5f5' };
const AXIS_VIEW: Record<AxisInfo['axis'], [ViewName, ViewName]> = {
  x: ['right', 'left'],
  y: ['top', 'bottom'],
  z: ['front', 'back'],
};

export function ViewportPane({ store, state, apiRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [axes, setAxes] = useState<AxisInfo[]>([]);
  const lastEpoch = useRef(state.projectEpoch);

  const project = state.history.present;
  const { selection, settings } = state;

  // Create and dispose the renderer with the component.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let vp: Viewport;
    try {
      vp = new Viewport(host, {
        onPick: (id, additive) => store.pick(id, additive),
        onOrientation: setAxes,
        onProblem: (m) => store.error(m),
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The 3D view could not start.');
      return;
    }
    setProblem(null);
    vpRef.current = vp;
    apiRef.current = { getGroundTarget: () => vp.getGroundTarget(), frame: () => vp.frame() };

    const s = store.getState();
    vp.setProject(s.history.present);
    vp.setSelection(s.selection);
    vp.setGridVisible(s.settings.showGrid);
    vp.setProjection(s.settings.orthographic ? 'orthographic' : 'perspective');
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
        <p className="hint">
          Try updating your browser or graphics drivers. Your project is safe and still saves normally.
        </p>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  const sorted = [...axes].sort((a, b) => a.depth - b.depth);

  return (
    <div className="viewport">
      <div className="viewport-host" ref={hostRef} />

      <div className="viewport-toolbar" role="toolbar" aria-label="View controls">
        <button className="btn small" onClick={() => vpRef.current?.frame()} title="Zoom to the selected part, or everything">
          Frame
        </button>
        <button className="btn small" onClick={() => vpRef.current?.resetView()} title="Back to the default angle">
          Reset view
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
          className={`btn small ${settings.orthographic ? 'active' : ''}`}
          aria-pressed={settings.orthographic}
          onClick={() => store.setSettings({ orthographic: !settings.orthographic })}
          title="Switch between perspective and flat (orthographic) camera"
        >
          {settings.orthographic ? 'Flat camera' : 'Perspective'}
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
                  fill={a.negative ? '#1b2029' : AXIS_COLORS[a.axis]}
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
  );
}
