import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Gauge,
  HeartPulse,
  Home,
  Keyboard,
  MousePointer2,
  ShieldAlert,
  SquareMousePointer,
} from "lucide-react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.port === "5173" ? "http://localhost:5001" : "");

const POLL_INTERVAL_MS = 5000;
const EMPTY_TREND = [0, 0, 0, 0, 0, 0, 0, 0];

const pages = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "metrics", label: "Live Metrics", icon: Activity },
  { id: "logic", label: "Risk Logic", icon: BrainCircuit },
  { id: "recovery", label: "Recovery", icon: HeartPulse },
];

const riskStyles = {
  LOW: {
    color: "#2dd4bf",
    soft: "rgba(45, 212, 191, 0.14)",
    label: "Normal working pattern",
    action: "Keep working. The current behavior is stable.",
  },
  MEDIUM: {
    color: "#fbbf24",
    soft: "rgba(251, 191, 36, 0.14)",
    label: "Early fatigue drift",
    action: "Slow down slightly and consider a short pause soon.",
  },
  HIGH: {
    color: "#fb7185",
    soft: "rgba(251, 113, 133, 0.14)",
    label: "High fatigue likelihood",
    action: "Take a break now. The model sees stacked fatigue signals.",
  },
  UNKNOWN: {
    color: "#94a3b8",
    soft: "rgba(148, 163, 184, 0.12)",
    label: "Waiting for data",
    action: "Open a normal website with the extension enabled to start telemetry.",
  },
};

const metricDefinitions = [
  {
    key: "keys",
    label: "Keys",
    suffix: "",
    icon: Keyboard,
    normal: "12-30 / 5s",
    description: "Total key presses captured in the latest 5-second window.",
  },
  {
    key: "mouse_distance",
    label: "Mouse Distance",
    suffix: "px",
    icon: MousePointer2,
    normal: "160-900 px / 5s",
    description: "Total cursor movement during the same model window.",
  },
  {
    key: "tab_switches",
    label: "Tab Switches",
    suffix: "",
    icon: SquareMousePointer,
    normal: "0-2 / 5s",
    description: "Browser tab changes collected by the extension service worker.",
  },
  {
    key: "backspace",
    label: "Backspace",
    suffix: "",
    icon: AlertTriangle,
    normal: "0-3 / 5s",
    description: "Backspace presses, used as a correction/error signal.",
  },
];

const riskRules = [
  {
    risk: "LOW",
    title: "Low risk",
    summary: "Normal focused work: steady typing, useful mouse movement, low corrections, and little context switching.",
    conditions: "Usually keys 12-30, mouse 160-900 px, tab switches 0-2, backspace 0-3 per 5 seconds.",
  },
  {
    risk: "MEDIUM",
    title: "Medium risk",
    summary: "Some drift from normal behavior. One or two signals are elevated, but the pattern is not severe yet.",
    conditions: "Often low or unusually high keys, mouse movement outside the normal band, 2-4 switches, or 3-6 backspaces.",
  },
  {
    risk: "HIGH",
    title: "High risk",
    summary: "Stacked fatigue signals. Low productive input plus switching or heavy corrections is treated as high risk.",
    conditions: "Common triggers: keys under 10 with 4+ switches, 6+ switches, 10+ backspaces, or very low keys plus very low mouse movement.",
  },
];

function formatClock(seconds) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function formatTime(value) {
  if (!value) {
    return "No updates yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No updates yet";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getLatestTelemetry(logs) {
  const latest = logs.at(-1);

  if (!latest) {
    return {
      latest: null,
      telemetry: {
        keys: 0,
        mouse_distance: 0,
        tab_switches: 0,
        backspace: 0,
      },
      risk: "UNKNOWN",
      score: 0,
    };
  }

  return {
    latest,
    telemetry: {
      keys: Number(latest.telemetry?.keys || 0),
      mouse_distance: Number(latest.telemetry?.mouse_distance || 0),
      tab_switches: Number(latest.telemetry?.tab_switches || 0),
      backspace: Number(latest.telemetry?.backspace || 0),
    },
    risk: latest.risk || "UNKNOWN",
    score: Number.isFinite(Number(latest.fatigue_score))
      ? Number(latest.fatigue_score) / 10
      : Number(latest.score || 0),
  };
}

function buildTrend(logs) {
  const scores = logs.slice(-8).map((entry) => clampPercent(Number(entry.score || 0) * 100));
  return [...EMPTY_TREND.slice(scores.length), ...scores];
}

function buildTrendPath(values) {
  const width = 760;
  const height = 240;
  const padding = 24;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1 || 1)) * innerWidth;
      const y = padding + ((100 - value) / 100) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function StatCard({ metric, value, risk }) {
  const Icon = metric.icon;

  return (
    <article className="glass-card metric-shine rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/6 text-slate-100">
          <Icon size={21} />
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: risk.soft, color: risk.color }}
        >
          5s window
        </span>
      </div>
      <p className="text-sm text-slate-400">{metric.label}</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-display text-4xl font-bold text-white">{Math.round(value)}</span>
        {metric.suffix ? <span className="pb-1 text-sm text-slate-400">{metric.suffix}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{metric.description}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.25em] text-slate-500">Normal: {metric.normal}</p>
    </article>
  );
}

function TrendPanel({ trend, risk }) {
  const path = buildTrendPath(trend);

  return (
    <div className="glass-card rounded-[34px] p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Live Trend</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-white">Fatigue Score Over Time</h2>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300">Polls every 5s</span>
      </div>
      <div className="h-72 rounded-[28px] border border-white/8 bg-[#07111f]/80 p-4">
        <svg viewBox="0 0 760 240" className="h-full w-full overflow-visible">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = 24 + ((100 - tick) / 100) * 192;
            return (
              <g key={tick}>
                <line x1="24" y1={y} x2="736" y2={y} stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="5 6" />
                <text x="0" y={y + 4} fill="#8ea3bd" fontSize="11">
                  {tick}
                </text>
              </g>
            );
          })}
          <path d={path} fill="none" stroke={risk.color} strokeWidth="4" strokeLinecap="round" />
          {trend.map((value, index) => {
            const x = 24 + (index / (trend.length - 1 || 1)) * 712;
            const y = 24 + ((100 - value) / 100) * 192;
            return <circle key={`${value}-${index}`} cx={x} cy={y} r="4.5" fill={risk.color} />;
          })}
        </svg>
      </div>
    </div>
  );
}

function Overview({ apiStatus, apiError, logs, latest, latestTimestamp, latestSource, risk, riskLevel, scorePercent, telemetry }) {
  const zeroWindow =
    telemetry.keys === 0 &&
    telemetry.mouse_distance === 0 &&
    telemetry.tab_switches === 0 &&
    telemetry.backspace === 0;
  const gaugeStyle = {
    background: `conic-gradient(${risk.color} ${scorePercent * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
  };

  return (
    <div className="space-y-6">
      {apiStatus === "offline" ? (
        <section className="glass-card rounded-[28px] border border-rose-400/25 bg-rose-500/10 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 text-rose-300" />
            <div>
              <p className="font-display text-xl font-semibold text-rose-100">Backend is not reachable</p>
              <p className="mt-1 text-sm text-rose-100/80">{apiError || "Start the Express server to receive predictions."}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="glass-card hero-grid overflow-hidden rounded-[34px] p-6 lg:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.35em] text-sky-300/75">Integrated ML Dashboard</p>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <span className="rounded-full px-4 py-1.5 text-sm font-semibold" style={{ backgroundColor: risk.soft, color: risk.color }}>
                  {riskLevel} RISK
                </span>
                <span className="rounded-full border border-white/10 px-4 py-1.5 text-sm text-slate-300">
                  {risk.label}
                </span>
              </div>
              <h2 className="max-w-xl font-display text-4xl font-bold leading-tight lg:text-5xl">
                Extension telemetry, Python model, and dashboard in one loop.
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
                Every 5 seconds the extension sends keys, mouse movement, tab switches, and backspace count to the Node API. The API calls the trained Python model and this dashboard reads the latest prediction.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-white/6 px-5 py-4">
                  <p className="text-sm text-slate-400">Fatigue Score</p>
                  <div className="font-display text-4xl font-bold">{scorePercent}%</div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/6 px-5 py-4">
                  <p className="text-sm text-slate-400">Windows Logged</p>
                  <div className="font-display text-4xl font-bold">{logs.length}</div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/6 px-5 py-4">
                  <p className="text-sm text-slate-400">Model Source</p>
                  <div className="font-display text-3xl font-bold capitalize">{latestSource}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-5">
              <div className="gauge-ring relative flex h-72 w-72 items-center justify-center rounded-full" style={gaugeStyle}>
                <div className="relative z-10 text-center">
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Live Score</p>
                  <div className="mt-3 font-display text-6xl font-bold">{scorePercent}</div>
                  <p className="mt-2 text-sm text-slate-400">Updated: {formatTime(latestTimestamp)}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-slate-300">
                {!latest ? "Waiting for first extension submission." : zeroWindow ? "No activity in the latest window, but monitoring continues." : risk.action}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-[34px] p-6">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Current Window</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-white">Raw Model Inputs</h2>
          <div className="mt-6 grid gap-3">
            {metricDefinitions.map((metric) => (
              <div key={metric.key} className="flex items-center justify-between rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
                <div>
                  <p className="font-medium text-white">{metric.label}</p>
                  <p className="text-sm text-slate-400">Normal: {metric.normal}</p>
                </div>
                <p className="font-display text-3xl font-bold" style={{ color: risk.color }}>
                  {Math.round(telemetry[metric.key])}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricDefinitions.map((metric) => (
          <StatCard key={metric.key} metric={metric} value={telemetry[metric.key]} risk={risk} />
        ))}
      </section>
    </div>
  );
}

function LiveDashboard() {
  const [activePage, setActivePage] = useState("overview");
  const [logs, setLogs] = useState([]);
  const [apiStatus, setApiStatus] = useState("connecting");
  const [apiError, setApiError] = useState("");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSessionSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchTelemetry = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/telemetry`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Backend responded with HTTP ${response.status}`);
        }

        const payload = await response.json();
        const nextLogs = Array.isArray(payload.data) ? payload.data : [];

        if (!cancelled) {
          setLogs(nextLogs);
          setApiStatus("online");
          setApiError("");
          setLastFetchedAt(new Date().toISOString());
        }
      } catch (error) {
        if (!cancelled) {
          setApiStatus("offline");
          setApiError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    fetchTelemetry();
    const poller = window.setInterval(fetchTelemetry, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, []);

  const { latest, telemetry, risk: riskLevel, score } = getLatestTelemetry(logs);
  const risk = riskStyles[riskLevel] || riskStyles.UNKNOWN;
  const trend = useMemo(() => buildTrend(logs), [logs]);
  const scorePercent = clampPercent(score * 100);
  const latestSource = latest?.source || "waiting";
  const latestTimestamp = latest?.timestamp || lastFetchedAt;

  const pagesById = {
    overview: (
      <Overview
        apiStatus={apiStatus}
        apiError={apiError}
        logs={logs}
        latest={latest}
        latestTimestamp={latestTimestamp}
        latestSource={latestSource}
        risk={risk}
        riskLevel={riskLevel}
        scorePercent={scorePercent}
        telemetry={telemetry}
      />
    ),
    metrics: (
      <div className="space-y-6">
        <section className="glass-card rounded-[34px] p-6">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Live Metrics</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-white">Latest 5-Second Telemetry</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            These values are not simulated. They come from the extension, pass through the Express API, and are echoed back with each model prediction.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metricDefinitions.map((metric) => (
              <StatCard key={metric.key} metric={metric} value={telemetry[metric.key]} risk={risk} />
            ))}
          </div>
        </section>
        <TrendPanel trend={trend} risk={risk} />
      </div>
    ),
    logic: (
      <section className="glass-card rounded-[34px] p-6">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Risk Logic</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-white">Model Conditions For A Normal Worker</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
          The Python model is trained on 5-second telemetry windows. A normal focused user usually has steady typing, some mouse movement, very few tab switches, and low backspace count.
        </p>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {riskRules.map((rule) => {
            const tone = riskStyles[rule.risk];
            return (
              <article key={rule.risk} className="rounded-3xl border border-white/8 bg-white/4 p-5">
                <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: tone.soft, color: tone.color }}>
                  {rule.risk}
                </span>
                <h3 className="mt-4 font-display text-2xl font-semibold text-white">{rule.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{rule.summary}</p>
                <p className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4 text-sm leading-6 text-slate-300">{rule.conditions}</p>
              </article>
            );
          })}
        </div>
      </section>
    ),
    recovery: (
      <section className="glass-card rounded-[34px] p-6">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Recovery</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-white">Recommended Action</h2>
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: risk.soft, color: risk.color }}>
              {riskLevel === "LOW" ? <CheckCircle2 /> : <ShieldAlert />}
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-white">{risk.action}</p>
              <p className="mt-2 text-sm leading-7 text-slate-400">
                The recommendation updates automatically as the extension submits new 5-second windows.
              </p>
            </div>
          </div>
        </div>
      </section>
    ),
  };

  return (
    <div className="min-h-screen px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <nav className="glass-card float-in flex flex-col gap-4 rounded-[28px] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-300/80">Human Fatigue & Error Predictor</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">NeuroShield</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Session Timer</p>
              <div className="mt-1 flex items-center gap-2 font-display text-xl font-semibold">
                <Clock3 size={18} className="text-sky-300" />
                {formatClock(sessionSeconds)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">API Status</p>
              <div className="mt-1 flex items-center gap-2 font-display text-xl font-semibold capitalize">
                <Gauge size={18} className={apiStatus === "online" ? "text-emerald-300" : "text-amber-300"} />
                {apiStatus}
              </div>
            </div>
          </div>
        </nav>

        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="glass-card float-in rounded-[34px] p-5">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Pages</p>
            <div className="mt-4 space-y-3">
              {pages.map((page) => {
                const Icon = page.icon;
                const active = activePage === page.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setActivePage(page.id)}
                    className={`flex w-full items-center gap-3 rounded-3xl border px-4 py-4 text-left transition ${
                      active
                        ? "border-sky-300/35 bg-sky-400/12"
                        : "border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/7"
                    }`}
                  >
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? "bg-sky-400/20 text-sky-300" : "bg-white/6 text-slate-300"}`}>
                      <Icon size={20} />
                    </div>
                    <p className="font-medium text-white">{page.label}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-3xl border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Pipeline</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Extension to Express API to Python model to React dashboard
              </p>
            </div>
          </aside>

          <main className="min-w-0">{pagesById[activePage]}</main>
        </div>

        <footer className="glass-card float-in rounded-[28px] px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-display text-xl font-semibold text-white">NeuroShield Integrated Demo</p>
              <p className="text-sm text-slate-400">
                Live frontend connected to Node.js, Python ML, and Chrome extension telemetry.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Backend: {API_BASE || "same-origin"}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Updates: every 5s</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default LiveDashboard;
