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
        // SystemToolConfig is discriminated on `type` at the top level and on
        // `params.system_tool_type` underneath - both literally "system" and
        // "end_call" respectively, plus a required `name`. Verified against
        // ElevenLabs' current agent-create schema; `{ end_call: {} }` is missing
        // all three required fields and 422s on the first real sync.
        built_in_tools: {
          end_call: { type: 'system', name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
        },
      },
    },
    // Pinned rather than left to server defaults: static/voice.js refuses anything
    // that doesn't match /^pcm_/, so an unrelated dashboard edit to either format
    // would silently kill the feature instead of erroring loudly like it does now.
    tts: { voice_id: 'onwK4e9ZLuTAKqWW03F9', agent_output_audio_format: 'pcm_16000' },
    asr: { user_input_audio_format: 'pcm_16000' },
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
    // The OpenAPI spec lists only is_enabled; ElevenLabs' own published doc examples
    // show isEnabled in the same place instead. The two disagree, and unknown fields
    // are ignored rather than rejected, so whichever one is wrong fails silently -
    // the request still succeeds and the guardrail is just off with nothing to say
    // so. Sending both costs nothing; a public agent carrying Charlie's name with
    // prompt-injection protection silently disabled is the worse failure by a wide
    // margin. Drop the redundant key once this is confirmed against a real response.
    focus: { is_enabled: true, isEnabled: true },
    prompt_injection: { is_enabled: true, isEnabled: true },
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

  // The knowledge base document has to exist before this call - its id is embedded
  // in conversation_config.agent.prompt.knowledge_base above, so uploadCorpus() can't
  // be moved after create/update the way a "don't strand a KB doc on failure" rule
  // would otherwise want. If the call below fails, that document is already real and
  // orphaned, so say so here rather than leaving a bare stack trace.
  const id = SITE.agent && SITE.agent.id;
  try {
    if (id) {
      await call('PATCH', `/convai/agents/${id}`, body);
      console.log(`updated agent ${id}`);
    } else {
      const created = await call('POST', '/convai/agents/create', body);
      console.log(`\ncreated agent ${created.agent_id}`);
      console.log(`put that in site.json under "agent": { "id": ... } and rebuild.`);
    }
  } catch (err) {
    console.error(`\nagent ${id ? 'update' : 'create'} failed, but knowledge base document ${docId} was`);
    console.error(`already uploaded and is now orphaned - remove it yourself in the dashboard's`);
    console.error(`knowledge base view.`);
    throw err;
  }

  // Every run uploads a fresh knowledge base document rather than editing the last
  // one, and nothing here deletes the old one - a script with delete access to
  // someone's paid account is a worse failure mode than an inert leftover file, and
  // the agent already points at the newest id regardless. Surfacing it is the only
  // honest middle ground: say what happened and where to clean up by hand.
  console.log(`\nthis created a new knowledge base document; earlier ones are no longer used by`);
  console.log(`this agent but are not deleted - remove them yourself in the dashboard's`);
  console.log(`knowledge base view if you want to.`);

  // This code has not run against the real API yet, and the isEnabled hedge above
  // exists precisely because that gap can't be closed from here - so the one check
  // that matters most has to happen the moment a human is next looking at the agent.
  console.log(`\nbefore trusting this agent with visitors, open it in the dashboard and confirm`);
  console.log(`focus and prompt injection guardrails both show as enabled.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
