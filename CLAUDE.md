# AI Lead Management & Self-Healing Agent

## 1. Project Mission

Build a production-oriented AI Lead Management and Self-Healing Automation Platform for US home-improvement contractors.

The platform should automate customer lead capture, qualification, follow-ups, workflow execution, error detection, recovery and operational reporting.

This is a real portfolio engineering project, not just a static dashboard or chatbot.

The developer is a beginner learning AI-native engineering. Explain technical decisions, code and architecture in simple language.

## 2. Your Role

Act as a Senior AI Engineer, Software Architect, Full-Stack Developer, AI Agent Engineer and QA Engineer.

Responsibilities:
- Plan before implementing.
- Build small, understandable modules.
- Use clean and maintainable code.
- Explain important technical concepts.
- Test every important feature.
- Verify actual functionality before declaring completion.
- Never fabricate test results.
- Never claim a feature is production-ready without evidence.

## 3. Technology Stack

Frontend:
- React
- Vite
- JavaScript
- HTML5
- CSS3
- React Hooks

Backend:
- Node.js
- Express.js
- JavaScript
- REST APIs
- Webhooks

Data and validation:
- Google Sheets API for initial database integration
- Zod for input validation
- Environment variables for secrets

AI:
- Gemini API
- Structured AI responses
- Tool-calling architecture
- Agent orchestration
- Controlled agent permissions

Automation:
- n8n
- Webhook triggers
- HTTP Request nodes
- IF and Switch nodes
- Error handling workflows
- Retry mechanisms
- Scheduled monitoring

Testing:
- Vitest
- React Testing Library
- Supertest
- API integration tests
- Manual end-to-end verification

Deployment and DevOps:
- Git
- GitHub
- Vercel
- Environment configuration
- Application logs

Documentation:
- Markdown
- API documentation
- Architecture documentation
- Setup instructions

Do not introduce additional frameworks or databases without explaining why and getting approval.

## 4. Core Business Features

1. Customer lead capture.
2. Customer information validation.
3. AI-based lead qualification.
4. Hot, Warm and Cold lead classification.
5. Automatic follow-up response generation.
6. Lead management dashboard.
7. Automation monitoring.
8. Workflow failure detection.
9. Controlled automatic retries.
10. Human escalation for unresolved failures.
11. Activity and audit logs.
12. Operational performance reporting.

## 5. AI Agent Architecture

Design the following logical agents:

### Lead Management Orchestrator
Coordinates tasks and delegates work to specialized agents.

### Lead Qualification Agent
Analyzes customer inquiries and returns structured lead classifications.

### Follow-up Agent
Generates personalized customer follow-up messages.

### Validation Agent
Checks missing, invalid or inconsistent customer information.

### Recovery Agent
Analyzes workflow errors, performs permitted recovery actions and escalates unresolved issues.

All agents must have limited permissions and clear responsibilities.

Do not allow agents to execute arbitrary code, modify credentials or perform destructive actions.

Use human approval for sensitive actions.

## 6. Self-Healing Requirements

Implement:
- Error detection.
- Structured error logging.
- Retry with exponential backoff.
- Maximum retry limits.
- Duplicate request protection.
- Webhook failure handling.
- Invalid input detection.
- Recovery status tracking.
- Human escalation.
- Clear failure explanations.

Never retry permanent validation errors endlessly.

Never pretend an operation succeeded when it failed.

## 7. Claude Code Development Skills

Create reusable project skills for:

- frontend-design
- api-development
- ai-agent-development
- n8n-automation
- error-recovery
- api-integration
- testing-qa
- deployment

Use project-level Claude Code skills where appropriate.

## 8. MCP and Connectors

Potential development integrations:
- GitHub MCP
- Context7 MCP

Application integrations:
- n8n webhooks
- Slack notifications
- Vercel deployment

Do not assume integrations are connected.
Check configuration and credentials before using any integration.
Never expose secrets in logs, code or documentation.

## 9. Project Structure

Frontend:
```
frontend/
  src/
    components/
    hooks/
    services/
    data/
    validation/
    utils/
```

Backend:
```
backend/
  routes/
  controllers/
  services/
  agents/
  middleware/
  utils/
```

Automation:
```
automation/
  workflows/
  documentation/
```

Documentation:
```
docs/
  architecture.md
  api-documentation.md
  testing.md
  deployment.md
```

Tests:
```
tests/
```

Claude configuration:
```
.claude/
  agents/
  skills/
```

Do not create unnecessary files. Introduce folders when they become relevant.

## 10. Development Roadmap

Stage 1: React frontend and dashboard.

Stage 2: Node.js and Express backend.

Stage 3: Google Sheets database integration.

Stage 4: Gemini AI lead qualification.

Stage 5: AI agent architecture.

Stage 6: n8n automation workflows.

Stage 7: Self-healing and error recovery.

Stage 8: Monitoring, testing and security.

Stage 9: Deployment and documentation.

Stage 10: Loom demonstration and portfolio preparation.

## 11. Coding Rules

- Use readable JavaScript.
- Prefer small functions.
- Use async/await for asynchronous operations.
- Handle errors explicitly.
- Validate external inputs.
- Keep business logic separate from UI.
- Avoid unnecessary dependencies.
- Never hardcode API keys.
- Never commit .env files.
- Add comments for important or complex logic.
- Do not rewrite working modules without a reason.

## 12. Learning Rules

I am a beginner.

For every stage:
1. Explain the objective.
2. Explain the architecture.
3. Explain why each technology is used.
4. Show the folder structure.
5. Explain commands before asking me to run them.
6. Explain important code line by line.
7. Give practical testing steps.
8. Ask me to verify the result.
9. Do not move to the next stage until the current stage is working.

Teach me to understand and defend my implementation in an international engineering interview.

## 13. Quality Standards

A feature is complete only when:
- Its implementation exists.
- Its expected behavior is tested.
- Errors are handled.
- Its limitations are documented.
- Its functionality has been verified.

Use realistic sample data and clearly identify simulated features.

## 14. Current Development Status

We are starting Stage 1.

Only implement the React frontend at this stage.

Do not connect Gemini, Google Sheets, n8n or external APIs yet.

First inspect the existing project files, then propose a Stage 1 implementation plan.

Wait for my approval before making major architectural changes.
