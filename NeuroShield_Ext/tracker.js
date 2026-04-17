(() => {
  const PREDICTION_WINDOW_MS = 5000;
  const ACTIVITY_SYNC_DEBOUNCE_MS = 250;
  const TELEMETRY_ENDPOINTS = [
    "http://localhost:5001/api/telemetry",
    "http://127.0.0.1:5001/api/telemetry",
    "http://[::1]:5001/api/telemetry"
  ];
  const DEFAULT_ACTIVITY_STATE = {
    keys: 0,
    mouse_distance: 0,
    backspace: 0
  };
  const DEFAULT_EXTENSION_STATE = {
    tabSwitches: 0,
    browserFocused: true,
    activeContext: null
  };
  const DEFAULT_POPUP_STATE = {
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

  if (window.__neuroShieldTrackerInitialized) {
    return;
  }

  window.__neuroShieldTrackerInitialized = true;

  if (window.top !== window) {
    return;
  }

  let isExtensionActive = true;
  let lastMousePos = null;
  let flushTimer = null;
  let persistTimer = null;
  let localKeys = 0;
  let localMouseDistance = 0;
  let localBackspace = 0;
  let isFlushInProgress = false;

  const teardown = () => {
    if (!isExtensionActive) {
      return;
    }

    isExtensionActive = false;

    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    window.removeEventListener("keydown", handleKeydown, keydownListenerOptions);
    window.removeEventListener("mousemove", handleMousemove, mousemoveListenerOptions);
    window.removeEventListener("pagehide", handlePageHide);
  };

  const hasExtensionAccess = () =>
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id) &&
    Boolean(chrome.storage?.local);

  const readLocalStorage = async (key, fallbackValue) => {
    if (!hasExtensionAccess()) {
      throw new Error("Extension context invalidated");
    }

    const stored = await chrome.storage.local.get(key);
    return stored[key] || fallbackValue;
  };

  const writeLocalStorage = async (key, value) => {
    if (!hasExtensionAccess()) {
      throw new Error("Extension context invalidated");
    }

    await chrome.storage.local.set({ [key]: value });
  };

  const handleExtensionFailure = (label, error) => {
    const message = error instanceof Error ? error.message : String(error);

    if (message.toLowerCase().includes("extension context invalidated")) {
      teardown();
      console.warn(
        `${label}: extension was reloaded or updated. Close this tab and open a fresh one.`
      );
      return;
    }

    console.error(`${label}:`, message);
  };

  const isPageActive = () =>
    document.visibilityState === "visible" && document.hasFocus();

  const keydownListenerOptions = { capture: true };
  const mousemoveListenerOptions = { passive: true };

  const persistLocalActivity = async () => {
    if (!isExtensionActive || !hasExtensionAccess()) {
      return;
    }

    if (localKeys === 0 && localMouseDistance === 0 && localBackspace === 0) {
      return;
    }

    const currentActivity = await readLocalStorage(
      "neuroShieldActivity",
      DEFAULT_ACTIVITY_STATE
    );

    await writeLocalStorage("neuroShieldActivity", {
      keys: Number(currentActivity.keys || 0) + localKeys,
      mouse_distance:
        Number(currentActivity.mouse_distance || 0) + Math.round(localMouseDistance),
      backspace: Number(currentActivity.backspace || 0) + localBackspace
    });

    localKeys = 0;
    localMouseDistance = 0;
    localBackspace = 0;
  };

  const schedulePersistActivity = () => {
    if (!isExtensionActive) {
      return;
    }

    if (persistTimer !== null) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      persistLocalActivity().catch((error) => {
        handleExtensionFailure("Activity sync failed", error);
      });
    }, ACTIVITY_SYNC_DEBOUNCE_MS);
  };

  const updatePopupState = async (nextState) => {
    const popupState = await readLocalStorage("neuroShieldPopup", DEFAULT_POPUP_STATE);
    await writeLocalStorage("neuroShieldPopup", {
      ...DEFAULT_POPUP_STATE,
      ...popupState,
      ...nextState
    });
  };

  const consumeSnapshotCounters = async (snapshot) => {
    const latestActivity = await readLocalStorage(
      "neuroShieldActivity",
      DEFAULT_ACTIVITY_STATE
    );
    const latestExtensionState = await readLocalStorage(
      "neuroShieldState",
      DEFAULT_EXTENSION_STATE
    );

    await writeLocalStorage("neuroShieldActivity", {
      keys: Math.max(0, Number(latestActivity.keys || 0) - Number(snapshot.keys || 0)),
      mouse_distance: Math.max(
        0,
        Number(latestActivity.mouse_distance || 0) - Number(snapshot.mouse_distance || 0)
      ),
      backspace: Math.max(
        0,
        Number(latestActivity.backspace || 0) - Number(snapshot.backspace || 0)
      )
    });

    await writeLocalStorage("neuroShieldState", {
      ...latestExtensionState,
      tabSwitches: Math.max(
        0,
        Number(latestExtensionState.tabSwitches || 0) -
          Number(snapshot.tab_switches || 0)
      )
    });
  };

  const postTelemetry = async (snapshot) => {
    let lastError = null;

    for (const endpoint of TELEMETRY_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(snapshot),
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${endpoint}`);
        }

        const result = await response.json();
        return { ok: true, endpoint, result };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      ok: false,
      error: lastError || "All loopback endpoints failed"
    };
  };

  const attemptTelemetryFlush = async () => {
    if (!isExtensionActive || !hasExtensionAccess() || isFlushInProgress) {
      return;
    }

    isFlushInProgress = true;

    try {
    await persistLocalActivity();

    const lock = await readLocalStorage("neuroShieldFlushState", {
      lastFlushAt: 0
    });
    const now = Date.now();

    if (now - Number(lock.lastFlushAt || 0) < PREDICTION_WINDOW_MS - 1000) {
      return;
    }

    await writeLocalStorage("neuroShieldFlushState", {
      lastFlushAt: now
    });

    const activity = await readLocalStorage("neuroShieldActivity", DEFAULT_ACTIVITY_STATE);
    const extensionState = await readLocalStorage(
      "neuroShieldState",
      DEFAULT_EXTENSION_STATE
    );
    const snapshot = {
      keys: Number(activity.keys || 0),
      mouse_distance: Number(activity.mouse_distance || 0),
      backspace: Number(activity.backspace || 0),
      tab_switches: Number(extensionState.tabSwitches || 0),
      timestamp: new Date().toISOString()
    };

    console.log("NeuroShield telemetry snapshot:", snapshot);

    await updatePopupState({
      lastSnapshot: snapshot,
      status: "submitting",
      lastError: null,
      lastUpdatedAt: new Date().toISOString()
    });

    const result = await postTelemetry(snapshot);

    if (result.ok) {
      await consumeSnapshotCounters(snapshot);
      await updatePopupState({
        lastSnapshot: snapshot,
        lastPrediction: result.result,
        status: "online",
        lastError: null,
        lastUpdatedAt: new Date().toISOString()
      });
      console.log("Fatigue prediction:", result.result);
      return;
    }

    await updatePopupState({
      lastSnapshot: snapshot,
      lastPrediction: null,
      status: "error",
      lastError: result.error,
      lastUpdatedAt: new Date().toISOString()
    });
    console.error("Telemetry submit failed:", result.error);
    } finally {
      isFlushInProgress = false;
    }
  };

  const isCountableKey = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    return event.key.length === 1 || event.key === "Enter";
  };

  const handleKeydown = (event) => {
    if (!isExtensionActive) {
      return;
    }

    if (!isPageActive()) {
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      localBackspace += 1;
    } else if (isCountableKey(event)) {
      localKeys += 1;
    }
    schedulePersistActivity();
  };

  const handleMousemove = (event) => {
    if (!isExtensionActive) {
      return;
    }

    if (!isPageActive()) {
      lastMousePos = null;
      return;
    }

    const currentMousePos = { x: event.clientX, y: event.clientY };

    if (lastMousePos) {
      const deltaX = currentMousePos.x - lastMousePos.x;
      const deltaY = currentMousePos.y - lastMousePos.y;
      localMouseDistance += Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      schedulePersistActivity();
    }

    lastMousePos = currentMousePos;
  };

  const handlePageHide = () => {
    persistLocalActivity().catch((error) => {
      handleExtensionFailure("Activity sync failed", error);
    });
  };

  window.addEventListener("keydown", handleKeydown, keydownListenerOptions);
  window.addEventListener("mousemove", handleMousemove, mousemoveListenerOptions);
  window.addEventListener("pagehide", handlePageHide);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      lastMousePos = null;
      persistLocalActivity().catch((error) => {
        handleExtensionFailure("Activity sync failed", error);
      });
    }
  });

  flushTimer = setInterval(() => {
    attemptTelemetryFlush().catch((error) => {
      handleExtensionFailure("Telemetry submit failed", error);
    });
  }, PREDICTION_WINDOW_MS);
})();
