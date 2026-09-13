// VACSO fleet — PM2 ecosystem config (generated 2026-08-17 from the live pm2 dump)
// Secrets live in ecosystem.secrets.json (gitignored), merged per-app below.
// Register/refresh the fleet:  pm2 delete all && pm2 start ecosystem.config.js && pm2 save
const fs = require('fs');
const path = require('path');
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(path.join(__dirname, 'ecosystem.secrets.json'), 'utf8')); } catch { /* no secrets file */ }

const apps = [
  {
    "name": "telemetry-service",
    "script": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service\\dist\\src\\index.js",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "interpreter": "node"
  },
  {
    "name": "telemetry-frontend",
    "script": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service\\frontend\\node_modules\\vite\\bin\\vite.js",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service\\frontend",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "interpreter": "node"
  },
  {
    "name": "science-service",
    "script": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service\\science\\.venv\\Scripts\\python.exe",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-telemetry-service\\science",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "-m",
      "uvicorn",
      "science.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8086"
    ]
  },
  {
    "name": "telemetry-mcp-http",
    "script": "C:\\Users\\oscar\\projects\\vacso-telemetry-service\\mcp-server\\dist\\index.js",
    "cwd": "C:\\Users\\oscar\\projects\\vacso-telemetry-service\\mcp-server",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "--http"
    ],
    "interpreter": "node",
    "env": {
      "NODE_ENV": "production",
      "MCP_HOST": "100.89.246.34",
      "MCP_PORT": "3051"
    }
  },
  {
    "name": "vacso-stt",
    "script": "C:\\Users\\oscar\\Projects\\vacso-stt\\.venv\\Scripts\\python.exe",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-stt",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "-m",
      "uvicorn",
      "app:app",
      "--host",
      "0.0.0.0",
      "--port",
      "8095"
    ],
    "env": {
      "STT_MODEL": "distil-large-v3",
      "STT_COMPUTE": "int8"
    }
  },
  {
    "name": "brand-studio",
    "script": "C:\\Users\\oscar\\Projects\\brand-studio-video\\node_modules\\next\\dist\\bin\\next",
    "cwd": "C:\\Users\\oscar\\Projects\\brand-studio-video",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "dev",
      "--webpack",
      "-p",
      "3005",
      "-H",
      "0.0.0.0"
    ],
    "interpreter": "C:\\Program Files\\nodejs\\node.exe"
  },
  {
    "name": "claude-bridge",
    "script": "C:\\Users\\oscar\\Projects\\vacso-hub\\services\\claude-bridge\\src\\server.mjs",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-hub",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "interpreter": "C:\\Program Files\\nodejs\\node.exe",
    "env": {
      "BRIDGE_ALLOWED_ROOTS": "C:/Users/oscar/Projects;C:/Users/oscar/AgentRuns",
      "BRIDGE_BLOCKED_MODELS": "fable"
    }
  },
  {
    "name": "brand-studio-mcp",
    "script": "C:\\Users\\oscar\\Projects\\brand-studio-video\\mcp-server\\dist\\index.js",
    "cwd": "C:\\Users\\oscar\\Projects\\brand-studio-video\\mcp-server",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "--http"
    ],
    "interpreter": "node",
    "env": {
      "MCP_HOST": "100.89.246.34",
      "MCP_PORT": "3052"
    }
  },
  {
    "name": "hub-client",
    "script": "C:\\Users\\oscar\\Projects\\vacso-hub\\node_modules\\vite\\bin\\vite.js",
    "cwd": "C:\\Users\\oscar\\Projects\\vacso-hub\\client",
    "windowsHide": true,
    "autorestart": true,
    "max_restarts": 10,
    "restart_delay": 5000,
    "args": [
      "--mode",
      "development",
      "--host",
      "127.0.0.1"
    ],
    "interpreter": "node"
  }
];

for (const app of apps) {
  if (secrets[app.name]) app.env = { ...(app.env || {}), ...secrets[app.name] };
}

module.exports = { apps };
