# OpenClaw Orchestrator HTTP API

## Overview

Orchestrator cung cấp HTTP REST API để trigger workflow execution, query metadata, và health check.

## Base URL

```
http://localhost:3002
```

Cấu hình qua environment variables (xem phần Configuration).

## Authentication

Tất cả endpoints (trừ `/api/health`) yêu cầu header:

```
X-API-Key: your-api-key
```

### Cấu hình API Keys

**Option 1: Environment Variable**
```bash
export OPENCLAW_API_KEYS="secret123,anotherkey456"
```

**Option 2: Config File**

Tạo file `.openclaw/config/api-keys.json`:
```json
{
  "keys": [
    "secret123",
    "anotherkey456"
  ]
}
```

**Lưu ý:** Nếu không có API keys được cấu hình, authentication sẽ bị **disabled** (chỉ dùng cho development).

---

## Endpoints

### GET /api/health

Health check endpoint (không cần authentication).

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-18T14:58:00.000Z"
}
```

**Status Codes:**
- `200 OK`

---

### GET /api/workflows

List tất cả workflows có sẵn.

**Headers:**
```
X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "workflows": [
    {
      "id": "social-content-gen",
      "name": "Social Content Generator",
      "version": "1.0",
      "stages": 4
    }
  ]
}
```

**Status Codes:**
- `200 OK`
- `401 Unauthorized` - Missing or invalid API key
- `500 Internal Server Error`

---

### GET /api/workflows/:id

Lấy workflow definition chi tiết.

**Headers:**
```
X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "workflow": {
    "id": "social-content-gen",
    "name": "Social Content Generator",
    "version": "1.0",
    "description": "Generate social media content from topic",
    "stages": [
      {
        "id": "research",
        "agentId": "research-agent",
        "task": "Research trending topics...",
        "timeout_seconds": 120
      }
    ],
    "max_parallel": 1,
    "timeout_minutes": 10
  }
}
```

**Status Codes:**
- `200 OK`
- `401 Unauthorized`
- `404 Not Found` - Workflow không tồn tại
- `500 Internal Server Error`

---

### POST /api/workflows/:id/execute

Execute một workflow với inputs.

**Headers:**
```
X-API-Key: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "inputs": {
    "project_path": "/path/to/project",
    "topic": "AI marketing",
    "tone": "viral"
  },
  "traceId": "optional-custom-trace-id"
}
```

**Response (Success):**
```json
{
  "success": true,
  "traceId": "api-req_1234567890_abc123",
  "status": "completed",
  "durationMs": 5432,
  "stages": [
    {
      "stageId": "research",
      "agentId": "research-agent",
      "status": "completed",
      "output": {
        "keywords": ["AI", "marketing", "automation"],
        "hashtags": ["#AIMarketing", "#MarTech"]
      },
      "durationMs": 1200,
      "modelUsed": "openrouter/anthropic/claude-3.7-sonnet"
    }
  ],
  "finalOutput": {
    "stages": [...],
    "summary": {
      "completed": 4,
      "failed": 0,
      "total": 4
    }
  },
  "errors": []
}
```

**Response (Failure):**
```json
{
  "success": false,
  "error": "Workflow execution failed: Stage 'research' timeout",
  "traceId": "api-req_1234567890_abc123",
  "status": "failed",
  "stages": [...],
  "errors": [
    {
      "code": "TIMEOUT",
      "message": "Stage 'research' exceeded timeout",
      "retryable": true
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Workflow completed (check `success` field)
- `401 Unauthorized`
- `404 Not Found` - Workflow không tồn tại
- `500 Internal Server Error`

---

### GET /api/metrics/summary

Lấy metrics summary (workflow stats, agent performance, reliability).

**Headers:**
```
X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "scope": "all-time",
    "generatedAt": "2026-03-18T14:58:00.000Z",
    "workflows": {
      "started": 42,
      "completed": 38,
      "failed": 4,
      "successRate": 0.9047,
      "avgDurationMs": 5234
    },
    "stages": {
      "completed": 152,
      "failed": 8,
      "avgLatencyMs": 1234,
      "p95LatencyMs": 3456
    },
    "agents": {
      "research-agent": {
        "calls": 42,
        "failures": 2,
        "failureRate": 0.0476,
        "avgLatencyMs": 1200
      }
    },
    "reliability": {
      "dispatcherErrors": 1,
      "timeouts": 3,
      "fallbacksUsed": 2,
      "retries": 5,
      "conflictsWaited": 0,
      "conflictTimeouts": 0,
      "circuitOpenCount": 0,
      "stuckStageTimeouts": 0
    }
  }
}
```

**Status Codes:**
- `200 OK`
- `401 Unauthorized`
- `500 Internal Server Error`

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid JSON hoặc missing required fields |
| 401 | Unauthorized - Missing hoặc invalid API key |
| 404 | Not Found - Workflow không tồn tại |
| 500 | Internal Server Error - Workflow execution failed hoặc server error |

**Error Response Format:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `OPENCLAW_ORCHESTRATOR_PORT` | `3002` | Port để listen |
| `OPENCLAW_ORCHESTRATOR_HOST` | `0.0.0.0` | Host để bind |
| `OPENCLAW_API_KEYS` | (none) | Comma-separated API keys |
| `OPENCLAW_DATA_DIR` | `./.openclaw` | Data directory (workflows, logs, metrics) |
| `OPENCLAW_ORCHESTRATOR_SSL_CERT` | (none) | Path to SSL certificate (enable HTTPS) |
| `OPENCLAW_ORCHESTRATOR_SSL_KEY` | (none) | Path to SSL private key (enable HTTPS) |

---

## Running the API Server

### Standalone Mode

```bash
# Build first
cd /Volumes/Home_EX/Projects/openclaw-orchestrator
npm run build

# Run API server
OPENCLAW_API_KEYS=secret123 node .openclaw/dist/api-server.js
```

### With Custom Data Directory

```bash
OPENCLAW_DATA_DIR=/path/to/data \
OPENCLAW_API_KEYS=secret123 \
node .openclaw/dist/api-server.js
```

### HTTPS Mode

```bash
OPENCLAW_ORCHESTRATOR_SSL_CERT=/path/to/cert.pem \
OPENCLAW_ORCHESTRATOR_SSL_KEY=/path/to/key.pem \
OPENCLAW_API_KEYS=secret123 \
node .openclaw/dist/api-server.js
```

---

## Example: Social Content Engine Integration

### Client Code (TypeScript)

```typescript
const ORCHESTRATOR_URL = 'http://localhost:3002';
const API_KEY = 'secret123';

async function generateContent(topic: string, tone: string) {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/workflows/social-content-gen/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      inputs: {
        topic,
        tone,
      },
    }),
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('Content generated:', result.finalOutput);
    return result.finalOutput;
  } else {
    console.error('Generation failed:', result.error);
    throw new Error(result.error);
  }
}

// Usage
generateContent('AI marketing', 'viral')
  .then(output => console.log('Success:', output))
  .catch(err => console.error('Error:', err));
```

### cURL Example

```bash
# Health check
curl http://localhost:3002/api/health

# List workflows
curl -H "X-API-Key: secret123" \
  http://localhost:3002/api/workflows

# Execute workflow
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: secret123" \
  -d '{
    "inputs": {
      "topic": "AI marketing",
      "tone": "viral"
    }
  }' \
  http://localhost:3002/api/workflows/social-content-gen/execute
```

---

## Logging

API server logs tất cả requests qua `orchestratorLogger`:

```
[API] POST /api/workflows/social-content-gen/execute 200 5432ms
[API] Execute workflow: social-content-gen
[API] Building file index for: /path/to/project
```

Logs được lưu trong `.openclaw/logs/`.

---

## Security Best Practices

1. **Always use API keys** trong production (không để empty)
2. **Use HTTPS** khi expose ra internet
3. **Restrict CORS origins** nếu cần (hiện tại allow all)
4. **Rate limiting** - có thể thêm `@fastify/rate-limit` sau
5. **Firewall** - chỉ expose port 3002 cho trusted networks

---

## Troubleshooting

### API keys không hoạt động

- Check env var: `echo $OPENCLAW_API_KEYS`
- Check config file: `cat .openclaw/config/api-keys.json`
- Check logs: API server sẽ log số lượng keys loaded

### Workflow không tìm thấy

- Check workflows directory: `ls .openclaw/workflows/`
- Ensure workflow JSON files có extension `.json`
- Check logs khi server start: `[orchestrator] Loaded workflow: ...`

### Port already in use

```bash
# Find process using port 3002
lsof -i :3002

# Kill it
kill -9 <PID>
```

---

## Next Steps

- Xem `examples/social-content-engine/` cho client implementation đầy đủ
- Tạo workflow mới trong `.openclaw/workflows/`
- Configure agent mapping trong `.openclaw/config/agent-mapping.json`
