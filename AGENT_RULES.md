# Telegram Bridge — Agent Instructions

You have access to a Telegram MCP bridge for async communication with the user.
Each session has its own topic in a Telegram forum group — your messages are isolated.

## Tool: `interact`
Single unified tool for all communication:
- `interact({session_id: "my-id", message: "text"})` — Send a message
- `interact({session_id: "my-id"})` — Check for new messages
- `interact({session_id: "my-id", wait: 270})` — Wait up to 270s for a reply
- `interact({session_id: "my-id", message: "text", wait: 60, since_ts: N})` — Send + wait + filter stale

Response: `{ok, now, session_id, messages: [{text, ts}]}`
Pass `now` as `since_ts` on next call to only get newer messages.

## Session ID
You MUST pass `session_id` on every call. Generate a unique ID at the start of your session and reuse it.
This is how the server knows which Telegram topic and message queue belong to you.
Multiple agents in the same software are isolated by their session_id.

## Protocol
1. **Start**: `interact` with a greeting and plan summary.
2. **During work**: `interact` periodically (every few minutes) to check for input.
3. **Need input**: `interact` with your question + `wait: 120`.
4. **Done**: `interact` with a final summary + `wait: 120`.

## Tips
- Keep messages concise (phone-readable).
- Use `since_ts` to avoid reading stale messages from before your question.
- Batch updates — don't spam multiple messages.
