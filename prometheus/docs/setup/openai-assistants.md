# OpenAI Assistants API Setup Guide

## Use God Agents as OpenAI Assistants

The `openai-assistants/` folder contains pre-formatted `.json` files ready for the Assistants API.

### Step 1: Create an Assistant via API

```javascript
import OpenAI from 'openai';
import { readFileSync } from 'fs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // BYOK

const agentConfig = JSON.parse(
  readFileSync('openai-assistants/zeus-executive-agent.json', 'utf8')
);

const assistant = await client.beta.assistants.create({
  name: agentConfig.name,
  instructions: agentConfig.instructions,
  model: 'gpt-4o',
  tools: [],
});

console.log('Assistant ID:', assistant.id);
// Save this ID — you'll use it to start threads
```

### Step 2: Create an Assistant via Playground

1. Go to [platform.openai.com/assistants](https://platform.openai.com/assistants)
2. Click **+ Create**
3. Open `openai-assistants/zeus-executive-agent.json`
4. Copy the `instructions` field value
5. Paste into the **Instructions** field in the Playground
6. Set the name and save

### Step 3: Run a Thread

```javascript
const thread = await client.beta.threads.create();

await client.beta.threads.messages.create(thread.id, {
  role: 'user',
  content: 'Prioritize our Q3 roadmap. We have 3 competing initiatives.',
});

const run = await client.beta.threads.runs.createAndPoll(thread.id, {
  assistant_id: assistant.id,
});

const messages = await client.beta.threads.messages.list(thread.id);
console.log(messages.data[0].content[0].text.value);
```

---

## Tips

- Your API key is used on your own account — BYOK, no shared credentials
- The `.json` format includes `name`, `instructions`, and `model` fields pre-filled
- Use the Assistants API for production applications that need persistent thread history
- For one-off queries, the Chat Completions API with the agent's `.txt` as a system prompt is simpler

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
