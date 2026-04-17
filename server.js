const cors = require("cors");
const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;
const MAX_LOGS = 100;
const logs = [];

const RISK_LABELS = {
  0: "LOW",
  1: "MEDIUM",
  2: "HIGH",
};

const PYTHON_SCRIPT = path.join(__dirname, "train_and_predict.py");

function resolvePythonRuntime() {
  if (process.env.PYTHON_BIN) {
    return { command: process.env.PYTHON_BIN, prefixArgs: [] };
  }

  if (process.platform === "win32") {
    const windowsCandidates = [
      "C:\\Program Files\\Python312\\python.exe",
      "C:\\Python312\\python.exe",
    ];

    const resolved = windowsCandidates.find((candidate) => fs.existsSync(candidate));
    if (resolved) {
      return { command: resolved, prefixArgs: [] };
    }

    return { command: "py", prefixArgs: ["-3"] };
  }

  return { command: "python3", prefixArgs: [] };
}

const PYTHON_RUNTIME = resolvePythonRuntime();

app.use(cors());
app.use(express.json());

function trimLogs() {
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

function buildFallbackResponse(input) {
  return {
    risk: "MEDIUM",
    score: 0.5,
    risk_index: 1,
    telemetry: input,
    source: "fallback",
    timestamp: new Date().toISOString(),
  };
}

function predictWithPython({ keys, mouse_distance, tab_switches }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PYTHON_RUNTIME.command,
      [
        ...PYTHON_RUNTIME.prefixArgs,
        PYTHON_SCRIPT,
        String(keys),
        String(mouse_distance),
        String(tab_switches),
      ],
      {
        cwd: __dirname,
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid Python response: ${stdout || error.message}`));
      }
    });
  });
}

function validateTelemetry(body) {
  const keys = Number(body.keys);
  const mouseDistance = Number(body.mouse_distance);
  const tabSwitches = Number(body.tab_switches);

  if (
    !Number.isFinite(keys) ||
    !Number.isFinite(mouseDistance) ||
    !Number.isFinite(tabSwitches)
  ) {
    return null;
  }

  return {
    keys: Math.round(Number(keys)),
    mouse_distance: Number(mouseDistance),
    tab_switches: Math.round(Number(tabSwitches)),
  };
}

app.get("/", (_req, res) => {
  res.json({ status: "online" });
});

app.post("/api/telemetry", async (req, res) => {
  const telemetry = validateTelemetry(req.body);

  if (!telemetry) {
    res.status(400).json({
      error: "Invalid telemetry payload. Expected keys, mouse_distance, tab_switches.",
    });
    return;
  }

  let responsePayload;

  try {
    const prediction = await predictWithPython(telemetry);
    responsePayload = {
      risk: RISK_LABELS[prediction.risk_index] || "MEDIUM",
      score: Number(prediction.probability) || 0.5,
      risk_index: prediction.risk_index,
      telemetry,
      source: "model",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    responsePayload = buildFallbackResponse(telemetry);
    responsePayload.error = error.message;
  }

  logs.push(responsePayload);
  trimLogs();

  res.json(responsePayload);
});

app.get("/api/telemetry", (_req, res) => {
  res.json({
    success: true,
    count: logs.length,
    data: logs,
  });
});

app.get("/api/logs", (_req, res) => {
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`Fatigue backend listening on http://localhost:${PORT}`);
});
