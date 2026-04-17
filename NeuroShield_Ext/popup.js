const defaultPopupState = {
  lastSnapshot: {
    keys: 0,
    mouse_distance: 0,
    backspace: 0,
    tab_switches: 0,
    timestamp: null
  },
  lastPrediction: null,
  status: "idle",
  lastError: null,
  lastUpdatedAt: null
};

const elements = {
  statusText: document.getElementById("status-text"),
  statusPill: document.getElementById("status-pill"),
  updatedAt: document.getElementById("updated-at"),
  keysValue: document.getElementById("keys-value"),
  mouseValue: document.getElementById("mouse-value"),
  tabsValue: document.getElementById("tabs-value"),
  backspaceValue: document.getElementById("backspace-value"),
  sourceValue: document.getElementById("source-value"),
  riskValue: document.getElementById("risk-value"),
  scoreValue: document.getElementById("score-value"),
  errorText: document.getElementById("error-text")
};

const statusCopy = {
  idle: "Waiting for the first 5-second window...",
  submitting: "Collecting the latest 5-second window...",
  online: "Model connected and responding.",
  error: "Last submission hit an error."
};

const formatTimestamp = (value) => {
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
    second: "2-digit"
  });
};

const applyRiskStyle = (risk) => {
  elements.riskValue.className = "risk";

  if (risk === "LOW") {
    elements.riskValue.classList.add("risk-low");
    return;
  }

  if (risk === "MEDIUM") {
    elements.riskValue.classList.add("risk-medium");
    return;
  }

  if (risk === "HIGH") {
    elements.riskValue.classList.add("risk-high");
    return;
  }

  elements.riskValue.classList.add("risk-neutral");
};

const render = (popupState) => {
  const state = {
    ...defaultPopupState,
    ...popupState,
    lastSnapshot: {
      ...defaultPopupState.lastSnapshot,
      ...(popupState?.lastSnapshot || {})
    }
  };

  elements.statusText.textContent = statusCopy[state.status] || statusCopy.idle;
  elements.statusPill.textContent = state.status.toUpperCase();
  elements.statusPill.className = `pill ${state.status}`;
  elements.updatedAt.textContent = `Updated ${formatTimestamp(state.lastUpdatedAt)}`;

  elements.keysValue.textContent = String(state.lastSnapshot.keys || 0);
  elements.mouseValue.textContent = String(state.lastSnapshot.mouse_distance || 0);
  elements.tabsValue.textContent = String(state.lastSnapshot.tab_switches || 0);
  elements.backspaceValue.textContent = String(state.lastSnapshot.backspace || 0);

  const prediction = state.lastPrediction || {};
  const risk = prediction.risk || "UNKNOWN";
  elements.riskValue.textContent = risk;
  applyRiskStyle(risk);

  const score = Number(prediction.score || 0);
  elements.scoreValue.textContent = score.toFixed(2);
  elements.sourceValue.textContent = prediction.source
    ? `Source: ${prediction.source}`
    : "No model response yet";

  if (state.lastError) {
    elements.errorText.textContent = state.lastError;
    elements.errorText.classList.remove("hidden");
  } else {
    elements.errorText.textContent = "";
    elements.errorText.classList.add("hidden");
  }
};

const loadState = async () => {
  const stored = await chrome.storage.local.get("neuroShieldPopup");
  render(stored.neuroShieldPopup || defaultPopupState);
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.neuroShieldPopup) {
    return;
  }

  render(changes.neuroShieldPopup.newValue || defaultPopupState);
});

loadState().catch((error) => {
  render({
    ...defaultPopupState,
    status: "error",
    lastError: error instanceof Error ? error.message : String(error)
  });
});
