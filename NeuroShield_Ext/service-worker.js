const DEFAULT_STATE = {
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

const sameContext = (left, right) =>
  Boolean(left) &&
  Boolean(right) &&
  left.windowId === right.windowId &&
  left.tabId === right.tabId;

const getExtensionState = async () => {
  const stored = await chrome.storage.local.get("neuroShieldState");
  return {
    ...DEFAULT_STATE,
    ...(stored.neuroShieldState || {})
  };
};

const setExtensionState = async (nextState) => {
  await chrome.storage.local.set({
    neuroShieldState: {
      ...DEFAULT_STATE,
      ...nextState
    }
  });
};

const getPopupState = async () => {
  const stored = await chrome.storage.local.get("neuroShieldPopup");
  return {
    ...DEFAULT_POPUP_STATE,
    ...(stored.neuroShieldPopup || {})
  };
};

const setPopupState = async (nextState) => {
  await chrome.storage.local.set({
    neuroShieldPopup: {
      ...DEFAULT_POPUP_STATE,
      ...nextState
    }
  });
};

const getActiveContextForWindow = async (windowId) => {
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const [tab] = tabs;

  if (!tab?.id) {
    return null;
  }

  return {
    windowId,
    tabId: tab.id
  };
};

const initializeExtensionState = async () => {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    const [tab] = tabs;

    await setExtensionState({
      tabSwitches: 0,
      browserFocused: true,
      activeContext: tab?.id
        ? {
            windowId: tab.windowId,
            tabId: tab.id
          }
        : null
    });
    await setPopupState(DEFAULT_POPUP_STATE);
  } catch (error) {
    console.error("Failed to initialize NeuroShield state:", error);
  }
};

const incrementTabSwitches = async (nextContext) => {
  const state = await getExtensionState();
  const hasSwitched =
    state.activeContext !== null && !sameContext(state.activeContext, nextContext);

  const nextState = {
    ...state,
    browserFocused: true,
    activeContext: nextContext
  };

  if (hasSwitched) {
    nextState.tabSwitches += 1;
    console.log("NeuroShield tab switch count:", nextState.tabSwitches);
  }

  await setExtensionState(nextState);
};

chrome.runtime.onInstalled.addListener(() => {
  initializeExtensionState();
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtensionState();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await incrementTabSwitches({
      windowId: activeInfo.windowId,
      tabId: activeInfo.tabId
    });
  } catch (error) {
    console.error("Failed to record tab activation:", error);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      const state = await getExtensionState();
      await setExtensionState({
        ...state,
        browserFocused: false
      });
      return;
    }

    const nextContext = await getActiveContextForWindow(windowId);
    if (!nextContext) {
      return;
    }

    const state = await getExtensionState();

    if (!state.browserFocused) {
      await setExtensionState({
        ...state,
        browserFocused: true,
        activeContext: nextContext
      });
      return;
    }

    await incrementTabSwitches(nextContext);
  } catch (error) {
    console.error("Failed to record window focus change:", error);
  }
});
