# ChatGPT Setup Guide

## Option A: Custom GPT (Recommended)

Create a dedicated Custom GPT for each agent you want to use regularly.

### Step 1: Open the GPT Builder

Go to [chatgpt.com](https://chatgpt.com) → Your Profile → My GPTs → Create a GPT

### Step 2: Configure the Instructions

1. Click **Configure** tab
2. Open your kit's `chatgpt/` folder
3. Copy the contents of the agent file (e.g., `zeus-executive-agent.txt`)
4. Paste into the **Instructions** field

### Step 3: Name and save

- Name: `God Agent Zeus` (or whichever agent)
- Click **Save** → **Only me** (private) or **Anyone with the link**

### Step 4: Invoke

Open the Custom GPT and start with the agent's natural invocation:
```
I need to prioritize our Q3 roadmap. Assess the situation and route to the right Pantheon agents.
```

---

## Option B: System Prompt in a Chat

For one-off sessions without creating a Custom GPT:

1. Start a new chat
2. Paste the agent's `.txt` content as your first message, prefixed with "You are:"
3. Continue the conversation

---

## Tips

- Build a Zeus GPT first — he routes tasks to the specialist agents
- Create a separate Custom GPT for agents you use daily (Ares for sales calls, Apollo for content, etc.)
- ChatGPT Custom GPTs persist your configuration across sessions

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
