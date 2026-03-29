# ABSuite - Getting Started Guide 🚀

## Quick Start (5 minutes)

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose
- pnpm (`npm install -g pnpm`)

### 1. Clone and Install
```bash
git clone <repository-url>
cd absuite-core
pnpm install
```

### 2. Start All Services
```bash
# Option A: Using Docker (Recommended for production)
docker compose up -d

# Option B: Using the CLI (Development mode)
npx absuite-core suite:start
```

### 3. Access the Dashboard
Open http://localhost:3001 in your browser

## What's Running?

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3001 | Modern React UI with AI Studio |
| CapKit | 8081 | Security & AI policy generation |
| Edge-Run | 8082 | Agent scheduling & self-healing |
| QuickBench | 8083 | Benchmarking & A/B testing |
| Connector | 8084 | Adapter factory & AI agent generation |
| Database | Internal | SQLite for persistence |

## First Steps

### 1. Generate Your First AI Policy
1. Go to http://localhost:3001
2. Click "🤖 AI Studio" in the sidebar
3. Select your AI provider (Ollama for local, OpenAI/Anthropic for cloud)
4. Enter: "Allow GitHub issues access for 1 hour"
5. Click "Generate Policy"
6. Copy the generated YAML policy

### 2. Create a Capability Token
```bash
curl -X POST http://localhost:8081/issue \
  -H "Content-Type: application/json" \
  -d '{
    "action": "github:issues:read",
    "resource": "myorg/myrepo",
    "expiresIn": "1h"
  }'
```

### 3. Generate an AI Agent
1. In AI Studio, go to "Agent Builder"
2. Enter: "Create a Slack bot that posts daily summaries"
3. The AI will generate a complete TypeScript adapter

### 4. Schedule an Agent
```bash
curl -X POST http://localhost:8082/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "cron": "0 9 * * *",
    "agent": "slack-daily-summary",
    "token": "<your-capability-token>"
  }'
```

## Configuration

### Environment Variables

Create a `.env` file in the root:

```env
# AI Providers (optional - defaults to Ollama)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_HOST=http://localhost:11434

# Security
JWT_SECRET=your-secret-key
HMAC_SECRET=your-hmac-secret

# Database
DATABASE_PATH=./data/absuite.db

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### AI Provider Setup

#### Option 1: Ollama (Local - Sovereign)
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2

# Start Ollama
ollama serve
```

#### Option 2: OpenAI (Cloud)
```bash
export OPENAI_API_KEY=sk-...
```

#### Option 3: Anthropic (Cloud)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Using the Dashboard

### Overview Tab
- View all service statuses
- Start/stop services with one click
- See real-time connection status
- Monitor system health

### AI Studio Tab
- **Policy Generator**: Create security policies from natural language
- **Agent Builder**: Generate complete TypeScript adapters
- **AI Assistant**: Chat with the system for help

### Monitoring Tab
- View real-time metrics
- Check service health
- See logs and events

### Settings Tab
- Configure AI providers
- View provider availability
- Update system settings

## API Examples

### CapKit (Security)
```bash
# Issue a capability token
curl -X POST http://localhost:8081/issue \
  -d '{"action":"github:repo:read","resource":"*","expiresIn":"2h"}'

# Verify a token
curl -X POST http://localhost:8081/verify \
  -d '{"token":"...","action":"github:repo:read"}'

# Generate AI policy
curl -X POST http://localhost:8081/ai/policy/generate \
  -d '{"description":"Allow Slack messaging for 30 minutes"}'
```

### Edge-Run (Scheduling)
```bash
# Schedule a job
curl -X POST http://localhost:8082/schedule \
  -d '{"cron":"*/5 * * * *","agent":"my-agent","priority":"high"}'

# List jobs
curl http://localhost:8082/jobs

# Cancel a job
curl -X POST http://localhost:8082/cancel/123
```

### QuickBench (Benchmarking)
```bash
# Run evaluation
curl -X POST http://localhost:8083/eval \
  -d '{"dataset":"datasets/en-global-sentiment.csv"}'

# Create A/B test
curl -X POST http://localhost:8083/ab-test \
  -d '{"name":"gpt4-vs-claude","variants":["gpt-4","claude-3"]}'
```

### Connector-Starter (Adapters)
```bash
# Generate adapter
curl -X POST http://localhost:8084/ai/agent/generate \
  -d '{"description":"Discord bot for server moderation"}'

# List adapters
curl http://localhost:8084/adapters
```

## Development Mode

### Hot Reload
```bash
# Dashboard UI
cd packages/dashboard-ui
pnpm dev

# Individual services
cd packages/capkit
pnpm dev

cd packages/edge-run
pnpm dev
```

### Testing
```bash
# Run all tests
pnpm test

# Test specific package
pnpm --filter capkit test

# Test with coverage
pnpm test --coverage
```

## Production Deployment

### Docker Compose (Recommended)
```bash
# Production build
docker compose -f docker-compose.yml up -d

# View logs
docker compose logs -f

# Scale services
docker compose up -d --scale edge-run=3
```

### Kubernetes (Advanced)
```bash
# Apply manifests
kubectl apply -f k8s/

# Check status
kubectl get pods -n absuite
```

### Environment-Specific Configs

#### Development
```yaml
# docker-compose.dev.yml
services:
  dashboard:
    volumes:
      - ./packages/dashboard-ui/src:/app/src
    environment:
      - NODE_ENV=development
```

#### Production
```yaml
# docker-compose.prod.yml
services:
  dashboard:
    restart: always
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=warn
```

## Troubleshooting

### Services Won't Start
```bash
# Check logs
docker compose logs <service-name>

# Restart service
docker compose restart <service-name>

# Check health
curl http://localhost:<port>/health
```

### AI Provider Not Available
```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Test OpenAI
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Dashboard Not Loading
```bash
# Check if dashboard is running
curl http://localhost:3001

# Rebuild dashboard
cd packages/dashboard-ui
pnpm build
```

### Database Issues
```bash
# Reset database (WARNING: Deletes all data)
rm -rf data/absuite.db
docker compose restart absuite-db
```

## Next Steps

1. **Read the Docs**: Check `docs/` directory for detailed guides
2. **Join Community**: Discord server for support
3. **Contribute**: See `CONTRIBUTING.md` for guidelines
4. **Deploy**: Follow `DEPLOYMENT.md` for production setup

## Support

- 📧 Email: support@absuite.dev
- 💬 Discord: https://discord.gg/absuite
- 🐙 GitHub Issues: https://github.com/absuite/core/issues

## License

MIT License - See LICENSE file for details
