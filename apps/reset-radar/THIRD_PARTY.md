# Upstream components

- `@modelcontextprotocol/sdk` 1.32.2 — MIT, https://github.com/modelcontextprotocol/typescript-sdk. Used for MCP server/client protocol and Web Standard Streamable HTTP transport. License remains in the installed package; the dependency version is pinned.
- `@modelcontextprotocol/ext-apps` 1.2.2 — MIT, https://github.com/modelcontextprotocol/ext-apps. Used for the UI bridge and app lifecycle; bundled code retains upstream license comments.
- `zod` — MIT, https://github.com/colinhacks/zod. Runtime validation dependency, pinned by package-lock.json.
- `esbuild` 0.25.12 — MIT, https://github.com/evanw/esbuild. Build dependency.

OpenAI static entrypoint metadata follows https://developers.openai.com/plugins/build/extensions and https://github.com/openai/mcp-extensions/blob/main/docs/spec.md, observed 2026-11-13. We use the documented metadata without copying the extension SDK. Static entrypoint support remains a host capability; protocol metadata does not prove a particular host renders it.

The panel itself contains no OpenAI inference SDK, calls, or model credentials. Existing cloud signal summaries may have been reviewed by the pre-existing watcher; this panel displays those published results.
