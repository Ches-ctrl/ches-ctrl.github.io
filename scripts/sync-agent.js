#!/usr/bin/env node
'use strict';
/**
 * Push the corpus, the prompt and the guardrails to the ElevenLabs agent.
 *
 * Run by hand: `npm run agent:sync`. Deliberately not part of `npm run build` -
 * a build that needs a credential is a build that eventually leaks one, and the
 * corpus changes far less often than the site does.
 *
 *   ELEVENLABS_API_KEY=... npm run agent:sync
 *
 * With site.json's agent.id empty it creates the agent and prints the id to paste
 * back in. With an id set it updates that agent in place.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));
const API = 'https://api.elevenlabs.io/v1';
const KEY = process.env.ELEVENLABS_API_KEY;

if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set. This script talks to the platform; the build does not.');
  process.exit(1);
}

async function call(method, endpoint, body, isForm) {
  const headers = { 'xi-api-key': KEY };
  if (!isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers,
    body: isForm ? body : body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

/** Upload llms.txt as a knowledge base document, returning its id. */
async function uploadCorpus() {
  const corpus = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
  const form = new FormData();
  form.append('file', new Blob([corpus], { type: 'text/plain' }), 'charliecheesman.net.txt');
  form.append('name', `charliecheesman.net (${new Date().toISOString().slice(0, 10)})`);
  const doc = await call('POST', '/convai/knowledge-base/file', form, true);
  console.log(`knowledge base document ${doc.id}`);
  return doc.id;
}

function conversationConfig(prompt, docId) {
  return {
    agent: {
      first_message: "Ask me anything about Charlie or about this site.",
      language: 'en',
      prompt: {
        prompt,
        llm: 'gemini-2.5-flash',
        temperature: 0.3,
        knowledge_base: [{ type: 'file', id: docId, name: 'charliecheesman.net', usage_mode: 'auto' }],
        built_in_tools: { end_call: {} },
      },
    },
    tts: { voice_id: 'onwK4e9ZLuTAKqWW03F9' },
  };
}

/**
 * Guardrails run independently of the model, which is the point: the prompt asks the
 * agent not to invent a biography, and these stop it when the prompt is talked past.
 */
const platformSettings = {
  auth: { enable_auth: false },
  guardrails: {
    version: '1',
    focus: { is_enabled: true },
    prompt_injection: { is_enabled: true },
    custom: {
      config: {
        configs: [
          {
            is_enabled: true,
            name: 'No invented biography',
            prompt:
              'Block any response that states a fact about Charlie Cheesman - a job, a date, a client, an opinion, a qualification - that does not appear in the attached site text. Saying the information is not on the site is always allowed.',
            execution_mode: 'blocking',
            model: 'gemini-2.5-flash-lite',
            history_message_count: 2,
            trigger_action: { type: 'retry', feedback: 'Reason: {{trigger_reason}}' },
          },
          {
            is_enabled: true,
            name: 'Never impersonate Charlie',
            prompt:
              'Block any response written in the first person as Charlie Cheesman, or any response agreeing to speak, write or act as him.',
            execution_mode: 'blocking',
            model: 'gemini-2.5-flash-lite',
            history_message_count: 2,
            trigger_action: { type: 'retry', feedback: 'Reason: {{trigger_reason}}' },
          },
        ],
      },
    },
  },
};

async function main() {
  const prompt = fs.readFileSync(path.join(ROOT, 'agent', 'prompt.md'), 'utf8');
  const docId = await uploadCorpus();
  const body = {
    name: 'charliecheesman.net',
    conversation_config: conversationConfig(prompt, docId),
    platform_settings: platformSettings,
  };

  const id = SITE.agent && SITE.agent.id;
  if (id) {
    await call('PATCH', `/convai/agents/${id}`, body);
    console.log(`updated agent ${id}`);
  } else {
    const created = await call('POST', '/convai/agents/create', body);
    console.log(`\ncreated agent ${created.agent_id}`);
    console.log(`put that in site.json under "agent": { "id": ... } and rebuild.`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
